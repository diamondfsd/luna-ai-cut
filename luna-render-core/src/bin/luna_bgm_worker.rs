use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use rustysynth::{MidiFile, MidiFileSequencer, SoundFont, Synthesizer, SynthesizerSettings};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::{self, Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const PPQ: i64 = 480;
const SAMPLE_RATE: u32 = 44_100;
const WAV_CHANNELS: u16 = 2;
const NORMALIZED_PEAK: f64 = 0.88;

type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone)]
struct Pattern {
    kind: String,
    rate: f64,
    tokens: Vec<String>,
    duration: Option<f64>,
    velocity: Option<i32>,
    direction: String,
}

#[derive(Debug, Clone)]
struct TrackPlan {
    name: String,
    channel: u8,
    program: u8,
    velocity: i32,
    register: String,
    patterns: Vec<Pattern>,
}

#[derive(Debug, Clone)]
struct Section {
    bars: usize,
    repeat: usize,
    chords: Vec<String>,
    crescendo: i32,
    tracks: Vec<TrackPlan>,
}

#[derive(Debug, Clone)]
struct Document {
    duration_seconds: f64,
    tempo_bpm: u16,
    numerator: u8,
    denominator: u8,
    sections: Vec<Section>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MusicSpec {
    schema_version: u8,
    duration_seconds: f64,
    tempo_bpm: u16,
    time_signature: TimeSignature,
    tracks: Vec<MusicTrack>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TimeSignature {
    numerator: u8,
    denominator: u8,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MusicTrack {
    name: String,
    midi_channel: u8,
    program: u8,
    events: Vec<MusicEvent>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
struct MusicEvent {
    start_beat: serde_json::Value,
    duration_beats: serde_json::Value,
    pitches: Vec<u8>,
    velocity: u8,
}

#[derive(Debug, Clone)]
struct InputLine {
    number: usize,
    indent: usize,
    tokens: Vec<String>,
}

fn err(line: usize, message: impl AsRef<str>) -> String {
    format!("line {line}: {}", message.as_ref())
}

fn parse_int(value: &str, line: usize, field: &str, min: i32, max: i32) -> Result<i32> {
    let parsed = value
        .parse::<i32>()
        .map_err(|_| err(line, format!("{field} must be an integer")))?;
    if !(min..=max).contains(&parsed) {
        return Err(err(line, format!("{field} must be {min}..{max}")));
    }
    Ok(parsed)
}

fn parse_number(value: &str, line: usize, field: &str, min: f64) -> Result<f64> {
    let parsed = value
        .parse::<f64>()
        .map_err(|_| err(line, format!("{field} must be a number")))?;
    if !parsed.is_finite() || parsed < min {
        return Err(err(
            line,
            format!("{field} must be a finite number >= {min}"),
        ));
    }
    Ok(parsed)
}

fn parse_duration(value: &str, line: usize) -> Result<f64> {
    let numeric = value.strip_suffix('s').unwrap_or(value);
    parse_number(numeric, line, "duration", 0.001)
}

fn is_numeric_suffix(value: &str) -> bool {
    let mut dot_seen = false;
    let mut digit_seen = false;
    for character in value.chars() {
        if character == '.' && !dot_seen {
            dot_seen = true;
        } else if character.is_ascii_digit() {
            digit_seen = true;
        } else {
            return false;
        }
    }
    digit_seen
}

fn parse_options(
    tokens: &[String],
    line: usize,
) -> Result<(Vec<String>, Option<f64>, Option<i32>)> {
    let mut body = Vec::new();
    let mut duration = None;
    let mut velocity = None;
    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        if token == "duration" || token == "velocity" {
            if index + 1 >= tokens.len() {
                return Err(err(line, format!("option {token:?} needs one value")));
            }
            let value = &tokens[index + 1];
            if token == "duration" {
                if duration.is_some() {
                    return Err(err(line, "duration option is repeated"));
                }
                duration = Some(parse_number(value, line, "pattern duration", 0.001)?);
            } else {
                if velocity.is_some() {
                    return Err(err(line, "velocity option is repeated"));
                }
                velocity = Some(parse_int(value, line, "pattern velocity", 1, 127)?);
            }
            index += 2;
            continue;
        }
        if token.len() > 1
            && (token.starts_with('d') || token.starts_with('v'))
            && is_numeric_suffix(&token[1..])
        {
            if token.starts_with('d') {
                if duration.is_some() {
                    return Err(err(line, "duration option is repeated"));
                }
                duration = Some(parse_number(&token[1..], line, "pattern duration", 0.001)?);
            } else {
                if velocity.is_some() {
                    return Err(err(line, "velocity option is repeated"));
                }
                velocity = Some(parse_int(&token[1..], line, "pattern velocity", 1, 127)?);
            }
            index += 1;
            continue;
        }
        body.push(token.clone());
        index += 1;
    }
    Ok((body, duration, velocity))
}

fn rate_for(token: &str) -> Option<f64> {
    match token {
        "whole" | "w" => Some(4.0),
        "half" | "h" => Some(2.0),
        "quarter" | "q" => Some(1.0),
        "eighth" | "e" => Some(0.5),
        "sixteenth" | "s" => Some(0.25),
        _ => None,
    }
}

fn parse_pattern(tokens: &[String], line: usize, command: &str) -> Result<Pattern> {
    let (mut body, duration, velocity) = parse_options(tokens, line)?;
    if body.is_empty() {
        return Err(err(line, format!("{command} needs a pattern")));
    }
    let rate = if let Some(value) = rate_for(&body[0]) {
        body.remove(0);
        value
    } else {
        1.0
    };
    let mut direction = "up".to_string();
    if command == "arpeggio" || command == "a" {
        if !body.is_empty() && ["up", "down", "updown"].contains(&body[0].as_str()) {
            direction = body.remove(0);
        }
        if body.is_empty() {
            return Err(err(line, "arpeggio needs note roles after its direction"));
        }
    }
    Ok(Pattern {
        kind: if command == "arpeggio" || command == "a" {
            "arpeggio"
        } else {
            "pattern"
        }
        .to_string(),
        rate,
        tokens: body,
        duration,
        velocity,
        direction,
    })
}

fn valid_name(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
}

fn parse_track(tokens: &[String], line: usize) -> Result<TrackPlan> {
    if tokens.len() < 2 || !valid_name(&tokens[1]) {
        return Err(err(line, "track needs a valid name"));
    }
    let mut channel = None;
    let mut program = 0;
    let mut velocity = 64;
    let mut register = "mid".to_string();
    if tokens[0] == "t" {
        for token in &tokens[2..] {
            if token.len() > 1
                && ["c", "i", "p", "v"].contains(&token[0..1].as_ref())
                && token[1..].parse::<i32>().is_ok()
            {
                let value = token[1..].parse::<i32>().unwrap_or(0);
                match &token[0..1] {
                    "c" => channel = Some(parse_int(&token[1..], line, "channel", 0, 15)? as u8),
                    "i" | "p" => program = parse_int(&token[1..], line, "program", 0, 127)? as u8,
                    "v" => velocity = parse_int(&token[1..], line, "velocity", 1, 127)?,
                    _ => unreachable!(),
                }
                let _ = value;
            } else {
                register = match token.as_str() {
                    "l" => "low".to_string(),
                    "m" => "mid".to_string(),
                    "h" => "high".to_string(),
                    _ => return Err(err(line, format!("unknown compact track option {token:?}"))),
                };
            }
        }
    } else {
        let mut index = 2;
        while index < tokens.len() {
            if index + 1 >= tokens.len() {
                return Err(err(
                    line,
                    format!("track option {:?} needs one value", tokens[index]),
                ));
            }
            match tokens[index].as_str() {
                "channel" => {
                    channel = Some(parse_int(&tokens[index + 1], line, "channel", 0, 15)? as u8)
                }
                "program" => {
                    program = parse_int(&tokens[index + 1], line, "program", 0, 127)? as u8
                }
                "velocity" => velocity = parse_int(&tokens[index + 1], line, "velocity", 1, 127)?,
                "register" => register = tokens[index + 1].clone(),
                other => return Err(err(line, format!("unknown track option {other:?}"))),
            }
            index += 2;
        }
    }
    let register = match register.as_str() {
        "low" | "l" => "low",
        "mid" | "m" => "mid",
        "high" | "h" => "high",
        _ => return Err(err(line, "register must be low, mid, or high")),
    };
    let channel = channel.ok_or_else(|| err(line, "track requires channel N"))?;
    Ok(TrackPlan {
        name: tokens[1].clone(),
        channel,
        program,
        velocity,
        register: register.to_string(),
        patterns: Vec::new(),
    })
}

fn parse_section(tokens: &[String], line: usize) -> Result<Section> {
    if tokens[0] == "sec" {
        if !(3..=4).contains(&tokens.len()) {
            return Err(err(line, "compact section syntax is: sec NAME BARSxREPEAT"));
        }
        let parts: Vec<&str> = tokens[2].split('x').collect();
        if parts.len() > 2 || parts.first().is_none() {
            return Err(err(line, "compact section length must look like 4x4"));
        }
        let bars = parse_int(parts[0], line, "bars", 1, 1024)? as usize;
        let repeat = if parts.len() == 2 {
            parse_int(parts[1], line, "repeat", 1, 4096)? as usize
        } else {
            1
        };
        let crescendo = if tokens.len() == 4 {
            parse_int(&tokens[3], line, "crescendo", -127, 127)?
        } else {
            0
        };
        return Ok(Section {
            bars,
            repeat,
            chords: vec!["C".to_string()],
            crescendo,
            tracks: Vec::new(),
        });
    }
    if tokens.len() < 4 || tokens[2] != "bars" || !valid_name(&tokens[1]) {
        return Err(err(
            line,
            "section syntax is: section NAME bars N [repeat N]",
        ));
    }
    let bars = parse_int(&tokens[3], line, "bars", 1, 1024)? as usize;
    let mut repeat = 1;
    let mut crescendo = 0;
    let mut index = 4;
    while index < tokens.len() {
        if index + 1 >= tokens.len() {
            return Err(err(
                line,
                format!("section option {:?} needs one value", tokens[index]),
            ));
        }
        match tokens[index].as_str() {
            "repeat" => repeat = parse_int(&tokens[index + 1], line, "repeat", 1, 4096)? as usize,
            "crescendo" => crescendo = parse_int(&tokens[index + 1], line, "crescendo", -127, 127)?,
            other => return Err(err(line, format!("unknown section option {other:?}"))),
        }
        index += 2;
    }
    Ok(Section {
        bars,
        repeat,
        chords: vec!["C".to_string()],
        crescendo,
        tracks: Vec::new(),
    })
}

fn clean_line(raw: &str) -> String {
    let trimmed = raw.trim_start();
    if trimmed.starts_with('#') {
        return String::new();
    }
    let characters: Vec<char> = raw.chars().collect();
    for index in 1..characters.len() {
        if characters[index] == '#' && characters[index - 1].is_whitespace() {
            return characters[..index]
                .iter()
                .collect::<String>()
                .trim_end()
                .to_string();
        }
    }
    raw.trim_end().to_string()
}

fn tokenize_dsl(text: &str) -> Result<Vec<InputLine>> {
    let mut lines = Vec::new();
    for (index, raw) in text.lines().enumerate() {
        let number = index + 1;
        let cleaned = clean_line(raw);
        if cleaned.trim().is_empty() {
            continue;
        }
        if cleaned.contains('\t') {
            return Err(err(number, "tabs are not supported; use spaces"));
        }
        let indent = cleaned.len() - cleaned.trim_start_matches(' ').len();
        lines.push(InputLine {
            number,
            indent,
            tokens: cleaned.split_whitespace().map(str::to_string).collect(),
        });
    }
    Ok(lines)
}

fn parse_chord(symbol: &str, line: usize) -> Result<(i32, Vec<i32>)> {
    let mut chars = symbol.chars();
    let root_char = chars
        .next()
        .ok_or_else(|| err(line, "empty chord"))?
        .to_ascii_uppercase();
    let root: i32 = match root_char {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return Err(err(line, format!("invalid chord {symbol:?}"))),
    };
    let rest: String = chars.collect();
    let (accidental, quality): (i32, &str) = if let Some(stripped) = rest.strip_prefix('#') {
        (1, stripped)
    } else if let Some(stripped) = rest.strip_prefix('b') {
        (-1, stripped)
    } else {
        (0, rest.as_str())
    };
    let intervals: Vec<i32> = match quality {
        "" | "maj" | "major" => vec![0, 4, 7],
        "m" | "min" | "minor" => vec![0, 3, 7],
        "dim" => vec![0, 3, 6],
        "aug" => vec![0, 4, 8],
        "sus2" => vec![0, 2, 7],
        "sus4" => vec![0, 5, 7],
        "7" => vec![0, 4, 7, 10],
        "maj7" => vec![0, 4, 7, 11],
        "m7" => vec![0, 3, 7, 10],
        _ => return Err(err(line, format!("invalid chord {symbol:?}"))),
    };
    Ok(((root + accidental).rem_euclid(12), intervals))
}

fn parse_dsl(text: &str) -> Result<Document> {
    let lines = tokenize_dsl(text)?;
    if lines.is_empty() {
        return Err("DSL is empty".to_string());
    }
    if lines[0].indent != 0
        || !((lines[0].tokens == ["bgm", "1"]) || (lines[0].tokens == ["video-bgm", "1"]))
    {
        return Err(err(
            lines[0].number,
            "first line must be: bgm 1 or video-bgm 1",
        ));
    }
    let mut duration = None;
    let mut tempo = None;
    let mut numerator = None;
    let mut denominator = None;
    let mut sections = Vec::new();
    let mut index = 1;
    while index < lines.len() {
        let current = &lines[index];
        if current.indent != 0 {
            return Err(err(
                current.number,
                "top-level directives must not be indented",
            ));
        }
        let command = current.tokens[0].as_str();
        match command {
            "duration" | "dur" if current.tokens.len() == 2 => {
                duration = Some(parse_duration(&current.tokens[1], current.number)?);
                if duration.unwrap_or(0.0) > 3600.0 {
                    return Err(err(current.number, "duration must be <= 3600s"));
                }
                index += 1;
                continue;
            }
            "tempo" | "bpm" if current.tokens.len() == 2 => {
                tempo =
                    Some(parse_int(&current.tokens[1], current.number, "tempo", 20, 240)? as u16);
                index += 1;
                continue;
            }
            "meter" | "ts" if current.tokens.len() == 2 && current.tokens[1].contains('/') => {
                let parts: Vec<&str> = current.tokens[1].split('/').collect();
                if parts.len() != 2 {
                    return Err(err(current.number, "meter must look like 4/4"));
                }
                numerator =
                    Some(parse_int(parts[0], current.number, "meter numerator", 1, 32)? as u8);
                let parsed_denominator =
                    parse_int(parts[1], current.number, "meter denominator", 1, 32)? as u8;
                if !parsed_denominator.is_power_of_two() {
                    return Err(err(
                        current.number,
                        "meter denominator must be a power of two",
                    ));
                }
                denominator = Some(parsed_denominator);
                index += 1;
                continue;
            }
            "section" | "sec" => {}
            _ => {
                return Err(err(
                    current.number,
                    format!("unknown top-level directive {command:?}"),
                ))
            }
        }
        let mut section = parse_section(&current.tokens, current.number)?;
        index += 1;
        let mut seen_channels = HashSet::new();
        while index < lines.len() && lines[index].indent > current.indent {
            let child = &lines[index];
            if child.indent != 2 {
                return Err(err(child.number, "section members must use two spaces"));
            }
            match child.tokens[0].as_str() {
                "chords" | "harmony" | "ch" => {
                    if child.tokens.len() < 2 {
                        return Err(err(child.number, "chords needs at least one chord symbol"));
                    }
                    for symbol in &child.tokens[1..] {
                        parse_chord(symbol, child.number)?;
                    }
                    section.chords = child.tokens[1..].to_vec();
                    index += 1;
                }
                "variation" | "var" => {
                    let value = if child.tokens[0] == "var" && child.tokens.len() == 2 {
                        child.tokens[1].clone()
                    } else if child.tokens.len() == 3 && child.tokens[1] == "crescendo" {
                        child.tokens[2].clone()
                    } else {
                        return Err(err(
                            child.number,
                            "variation syntax is: variation crescendo N or var +N",
                        ));
                    };
                    section.crescendo = parse_int(&value, child.number, "crescendo", -127, 127)?;
                    index += 1;
                }
                "track" | "t" => {
                    let mut track = parse_track(&child.tokens, child.number)?;
                    if !seen_channels.insert(track.channel) {
                        return Err(err(
                            child.number,
                            format!(
                                "MIDI channel {} is duplicated in this section",
                                track.channel
                            ),
                        ));
                    }
                    index += 1;
                    while index < lines.len() && lines[index].indent > child.indent {
                        let pattern_line = &lines[index];
                        if pattern_line.indent != 4 {
                            return Err(err(
                                pattern_line.number,
                                "track patterns must use four spaces",
                            ));
                        }
                        if !["pattern", "p", "arpeggio", "a"]
                            .contains(&pattern_line.tokens[0].as_str())
                        {
                            return Err(err(
                                pattern_line.number,
                                "track directive must be pattern or arpeggio",
                            ));
                        }
                        track.patterns.push(parse_pattern(
                            &pattern_line.tokens[1..],
                            pattern_line.number,
                            &pattern_line.tokens[0],
                        )?);
                        index += 1;
                    }
                    if track.patterns.is_empty() {
                        return Err(err(child.number, "track needs at least one pattern"));
                    }
                    section.tracks.push(track);
                }
                other => {
                    return Err(err(
                        child.number,
                        format!("unknown section directive {other:?}"),
                    ))
                }
            }
        }
        if section.tracks.is_empty() {
            return Err(err(current.number, "section needs at least one track"));
        }
        sections.push(section);
    }
    if duration.is_none() || tempo.is_none() || numerator.is_none() || denominator.is_none() {
        return Err("missing required directive(s): duration, tempo, meter".to_string());
    }
    Ok(Document {
        duration_seconds: duration.unwrap_or(0.0),
        tempo_bpm: tempo.unwrap_or(120),
        numerator: numerator.unwrap_or(4),
        denominator: denominator.unwrap_or(4),
        sections,
    })
}

fn register_offset(register: &str) -> i32 {
    match register {
        "low" => -24,
        "high" => 12,
        _ => 0,
    }
}

fn role_pitches(role: &str, chord: (i32, Vec<i32>), register: &str) -> Result<Vec<u8>> {
    let normalized = match role {
        "r" => "root",
        "t" => "third",
        "c" => "chord",
        "o" => "octave",
        other => other,
    };
    let (root, intervals) = chord;
    let base = 60 + root + register_offset(register);
    if normalized == "chord" || normalized == "all" {
        return intervals
            .iter()
            .map(|interval| to_pitch(base + interval))
            .collect();
    }
    if normalized == "octave" {
        return to_pitch(base + 12).map(|value| vec![value]);
    }
    let role_index = match normalized {
        "1" | "root" => 0,
        "3" | "third" => 1,
        "5" | "fifth" => 2,
        "7" | "seventh" => 3,
        _ => {
            if let Some(pitch) = parse_absolute_pitch(normalized) {
                return to_pitch(pitch).map(|value| vec![value]);
            }
            return Err(format!("unknown note role {role:?}"));
        }
    };
    let interval = intervals[role_index.min(intervals.len() - 1)];
    to_pitch(base + interval).map(|value| vec![value])
}

fn parse_absolute_pitch(value: &str) -> Option<i32> {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() < 2 {
        return None;
    }
    let root = match chars[0].to_ascii_uppercase() {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return None,
    };
    let mut index = 1;
    let accidental = if chars.get(index) == Some(&'#') {
        index += 1;
        1
    } else if chars.get(index) == Some(&'b') {
        index += 1;
        -1
    } else {
        0
    };
    let octave: String = chars[index..].iter().collect();
    Some((octave.parse::<i32>().ok()? + 1) * 12 + root + accidental)
}

fn to_pitch(value: i32) -> Result<u8> {
    if !(0..=127).contains(&value) {
        return Err(format!("generated MIDI pitch out of range: {value}"));
    }
    Ok(value as u8)
}

fn number_value(value: f64) -> Value {
    if (value - value.round()).abs() < 1e-9 {
        json!(value.round() as i64)
    } else {
        json!((value * 1_000_000.0).round() / 1_000_000.0)
    }
}

fn append_event(
    events: &mut Vec<MusicEvent>,
    start: f64,
    duration: f64,
    pitches: Vec<u8>,
    velocity: i32,
) -> Result<()> {
    if pitches.is_empty() {
        return Ok(());
    }
    events.push(MusicEvent {
        start_beat: number_value(start),
        duration_beats: number_value(duration),
        pitches,
        velocity: velocity.clamp(1, 127) as u8,
    });
    Ok(())
}

fn frange(start: f64, stop: f64, step: f64) -> Vec<f64> {
    let mut values = Vec::new();
    let mut value = start;
    while value < stop - 1e-9 {
        values.push(value);
        value += step;
    }
    values
}

fn drum_pitch(role: &str) -> Result<u8> {
    let value = match role {
        "kick" => 36,
        "snare" => 38,
        "clap" => 39,
        "hat" | "closed_hat" => 42,
        "open_hat" => 46,
        "low_tom" => 45,
        "tom" => 47,
        "crash" => 49,
        "ride" => 51,
        other => other
            .parse::<i32>()
            .map_err(|_| format!("unknown drum role {other:?}"))?,
    };
    to_pitch(value)
}

fn compile_pattern(
    pattern: &Pattern,
    track: &TrackPlan,
    chord: (i32, Vec<i32>),
    bar_start: f64,
    bar_beats: f64,
    velocity: i32,
    events: &mut Vec<MusicEvent>,
) -> Result<()> {
    let is_drums = track.channel == 9;
    let event_duration = pattern
        .duration
        .unwrap_or((pattern.rate * 0.8).min(bar_beats.max(0.1)));
    if pattern.kind == "pattern"
        && !pattern.tokens.is_empty()
        && ["offbeat", "off", "pulse"].contains(&pattern.tokens[0].as_str())
    {
        let mode = &pattern.tokens[0];
        let roles: Vec<&str> = pattern.tokens[1..]
            .iter()
            .map(|role| if role == "c" { "chord" } else { role.as_str() })
            .collect();
        if roles.len() != 1 || !["chord", "all"].contains(&roles[0]) {
            return Err(format!("{mode} pattern requires exactly the chord role"));
        }
        let offsets = if mode == "pulse" {
            frange(0.0, bar_beats, pattern.rate)
        } else {
            (0..bar_beats.ceil() as usize)
                .map(|offset| offset as f64 + 0.5)
                .filter(|offset| *offset < bar_beats)
                .collect()
        };
        for offset in offsets {
            append_event(
                events,
                bar_start + offset,
                event_duration,
                role_pitches("chord", chord.clone(), &track.register)?,
                velocity,
            )?;
        }
        return Ok(());
    }
    let mut roles = pattern.tokens.clone();
    if pattern.direction == "down" {
        roles.reverse();
    } else if pattern.direction == "updown" && roles.len() > 1 {
        let middle: Vec<String> = roles[1..roles.len() - 1].iter().rev().cloned().collect();
        roles.extend(middle);
    }
    for (index, role) in roles.iter().enumerate() {
        let offset = index as f64 * pattern.rate;
        if offset >= bar_beats || ["-", ".", "rest"].contains(&role.as_str()) {
            continue;
        }
        let pitches = if is_drums {
            vec![drum_pitch(role)?]
        } else {
            role_pitches(role, chord.clone(), &track.register)?
        };
        append_event(
            events,
            bar_start + offset,
            event_duration,
            pitches,
            velocity,
        )?;
    }
    Ok(())
}

fn compile_document(document: &Document) -> Result<MusicSpec> {
    let bar_beats = document.numerator as f64 * 4.0 / document.denominator as f64;
    let mut track_map: Vec<MusicTrack> = Vec::new();
    let mut section_start = 0.0;
    for section in &document.sections {
        for source_track in &section.tracks {
            if let Some(existing) = track_map
                .iter()
                .find(|track| track.midi_channel == source_track.channel)
            {
                if existing.name != source_track.name || existing.program != source_track.program {
                    return Err(format!(
                        "MIDI channel {} changes name or program between sections",
                        source_track.channel
                    ));
                }
            } else {
                track_map.push(MusicTrack {
                    name: source_track.name.clone(),
                    midi_channel: source_track.channel,
                    program: source_track.program,
                    events: Vec::new(),
                });
            }
        }
        for repeat_index in 0..section.repeat {
            for bar_index in 0..section.bars {
                let bar_start =
                    section_start + (repeat_index * section.bars + bar_index) as f64 * bar_beats;
                let chord = parse_chord(&section.chords[bar_index % section.chords.len()], 0)?;
                for source_track in &section.tracks {
                    let output_track = track_map
                        .iter_mut()
                        .find(|track| track.midi_channel == source_track.channel)
                        .ok_or_else(|| "internal track lookup failure".to_string())?;
                    for pattern in &source_track.patterns {
                        let base_velocity = pattern.velocity.unwrap_or(source_track.velocity);
                        let velocity = base_velocity + repeat_index as i32 * section.crescendo;
                        compile_pattern(
                            pattern,
                            source_track,
                            chord.clone(),
                            bar_start,
                            bar_beats,
                            velocity,
                            &mut output_track.events,
                        )?;
                    }
                }
            }
        }
        section_start += section.bars as f64 * section.repeat as f64 * bar_beats;
    }
    for track in &mut track_map {
        track.events.sort_by(|left, right| {
            let start_left = left.start_beat.as_f64().unwrap_or(0.0);
            let start_right = right.start_beat.as_f64().unwrap_or(0.0);
            start_left
                .partial_cmp(&start_right)
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.pitches.cmp(&right.pitches))
        });
        if track.events.is_empty() {
            return Err(format!("track {:?} generated no note events", track.name));
        }
        if track.events.len() > 4096 {
            return Err(format!(
                "track {:?} generated too many events: {}",
                track.name,
                track.events.len()
            ));
        }
    }
    track_map.sort_by_key(|track| track.midi_channel);
    Ok(MusicSpec {
        schema_version: 1,
        duration_seconds: document.duration_seconds,
        tempo_bpm: document.tempo_bpm,
        time_signature: TimeSignature {
            numerator: document.numerator,
            denominator: document.denominator,
        },
        tracks: track_map,
    })
}

fn encode_vlq(mut value: u32) -> Vec<u8> {
    let mut buffer = vec![value as u8 & 0x7f];
    while {
        value >>= 7;
        value != 0
    } {
        buffer.push((value as u8 & 0x7f) | 0x80);
    }
    buffer.reverse();
    for index in 0..buffer.len().saturating_sub(1) {
        buffer[index] |= 0x80;
    }
    buffer
}

fn track_chunk(mut events: Vec<(i64, u8, Vec<u8>)>, end_tick: i64) -> Vec<u8> {
    events.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.cmp(&right.1))
            .then(left.2.cmp(&right.2))
    });
    let mut data = Vec::new();
    let mut last_tick = 0i64;
    for (tick, _, payload) in events {
        data.extend(encode_vlq((tick - last_tick).max(0) as u32));
        data.extend(payload);
        last_tick = tick;
    }
    data.extend(encode_vlq((end_tick - last_tick).max(0) as u32));
    data.extend([0xff, 0x2f, 0x00]);
    let mut result = b"MTrk".to_vec();
    result.extend((data.len() as u32).to_be_bytes());
    result.extend(data);
    result
}

fn build_midi(spec: &MusicSpec) -> Vec<u8> {
    let tempo = (60_000_000.0 / spec.tempo_bpm as f64).round() as u32;
    let duration_ticks = (spec.duration_seconds * spec.tempo_bpm as f64 / 60.0 * PPQ as f64)
        .round()
        .max(1.0) as i64;
    let denominator_power = (spec.time_signature.denominator as f64).log2() as u8;
    let conductor = track_chunk(
        vec![
            (
                0,
                0,
                vec![
                    0xff,
                    0x51,
                    0x03,
                    (tempo >> 16) as u8,
                    (tempo >> 8) as u8,
                    tempo as u8,
                ],
            ),
            (
                0,
                0,
                vec![
                    0xff,
                    0x58,
                    0x04,
                    spec.time_signature.numerator,
                    denominator_power,
                    24,
                    8,
                ],
            ),
        ],
        duration_ticks,
    );
    let mut tracks = vec![conductor];
    for track in &spec.tracks {
        let channel = track.midi_channel;
        let mut events = Vec::new();
        if channel != 9 {
            events.push((0, 0, vec![0xc0 | channel, track.program]));
        }
        let name = track.name.as_bytes();
        let mut name_event = vec![0xff, 0x03];
        name_event.extend(encode_vlq(name.len() as u32));
        name_event.extend(name);
        events.push((0, 1, name_event));
        for event in &track.events {
            let start = (event.start_beat.as_f64().unwrap_or(0.0) * PPQ as f64)
                .round()
                .max(0.0) as i64;
            let end = (start
                + (event.duration_beats.as_f64().unwrap_or(0.0) * PPQ as f64)
                    .round()
                    .max(1.0) as i64)
                .min(duration_ticks);
            if start >= duration_ticks || end <= start {
                continue;
            }
            for pitch in &event.pitches {
                events.push((start, 2, vec![0x90 | channel, *pitch, event.velocity]));
                events.push((end, 1, vec![0x80 | channel, *pitch, 0]));
            }
        }
        tracks.push(track_chunk(events, duration_ticks));
    }
    let mut result = b"MThd".to_vec();
    result.extend([0, 0, 0, 6]);
    result.extend([0, 1]);
    result.extend((tracks.len() as u16).to_be_bytes());
    result.extend((PPQ as u16).to_be_bytes());
    for track in tracks {
        result.extend(track);
    }
    result
}

fn project_root() -> PathBuf {
    if let Ok(root) = env::var("BGM_PROJECT_ROOT") {
        if !root.trim().is_empty() {
            return PathBuf::from(root);
        }
    }
    if let Ok(executable) = env::current_exe() {
        if let Some(directory) = executable.parent() {
            let packaged = directory.join("bgm");
            if packaged.is_dir() {
                return packaged;
            }
            let development = directory.join("../resources/bgm");
            if development.is_dir() {
                return development;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../resources/bgm")
        .to_path_buf()
}

fn default_soundfont() -> PathBuf {
    project_root().join("soundfonts/GeneralUser.sf2")
}

fn write_wav(left: &[f32], right: &[f32], destination: &Path) -> Result<()> {
    if left.len() != right.len() {
        return Err("rendered audio channels have different lengths".to_string());
    }
    let mut samples = Vec::with_capacity(left.len() * WAV_CHANNELS as usize);
    for (left, right) in left.iter().zip(right) {
        samples.push(*left);
        samples.push(*right);
    }
    let peak = samples
        .iter()
        .map(|sample| sample.abs())
        .fold(0.0_f32, f32::max);
    if !peak.is_finite() || peak <= f32::EPSILON {
        return Err("the composition produced silent audio".to_string());
    }
    let scale = (NORMALIZED_PEAK as f32) / peak;
    let mut output_data = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let clipped = (sample * scale).clamp(-1.0, 1.0);
        let encoded = (clipped * i16::MAX as f32).round() as i16;
        output_data.extend(encoded.to_le_bytes());
    }

    let mut output = Vec::with_capacity(44 + output_data.len());
    output.extend(b"RIFF");
    output.extend((36u32 + output_data.len() as u32).to_le_bytes());
    output.extend(b"WAVEfmt ");
    output.extend((16u32).to_le_bytes());
    output.extend((1u16).to_le_bytes());
    output.extend(WAV_CHANNELS.to_le_bytes());
    output.extend(SAMPLE_RATE.to_le_bytes());
    output.extend((SAMPLE_RATE * WAV_CHANNELS as u32 * 2).to_le_bytes());
    output.extend((WAV_CHANNELS * 2).to_le_bytes());
    output.extend((16u16).to_le_bytes());
    output.extend(b"data");
    output.extend((output_data.len() as u32).to_le_bytes());
    output.extend(output_data);

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create output directory: {error}"))?;
    }
    let temporary = destination.with_extension("wav.tmp");
    fs::write(&temporary, output).map_err(|error| format!("cannot write WAV: {error}"))?;
    #[cfg(windows)]
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| format!("cannot replace WAV: {error}"))?;
    }
    fs::rename(&temporary, destination).map_err(|error| format!("cannot finalize WAV: {error}"))?;
    Ok(())
}

fn render(spec: &MusicSpec, output: &Path, soundfont: &Path, keep_midi: bool) -> Result<Option<PathBuf>> {
    if !soundfont.is_file()
        || fs::metadata(soundfont)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
            == 0
    {
        return Err(format!(
            "SoundFont was not found: {}. Run node scripts/copy-bgm-assets.mjs or pass --soundfont PATH.",
            soundfont.display()
        ));
    }
    let midi_bytes = build_midi(spec);
    let midi_path = if keep_midi {
        let path = output.with_extension("mid");
        fs::write(&path, &midi_bytes).map_err(|error| format!("cannot write MIDI: {error}"))?;
        Some(path)
    } else {
        None
    };

    let mut soundfont_file = fs::File::open(soundfont)
        .map_err(|error| format!("cannot open SoundFont {}: {error}", soundfont.display()))?;
    let sound_font = Arc::new(
        SoundFont::new(&mut soundfont_file)
            .map_err(|error| format!("cannot parse SoundFont: {error}"))?,
    );
    let mut settings = SynthesizerSettings::new(SAMPLE_RATE as i32);
    settings.maximum_polyphony = 128;
    settings.enable_reverb_and_chorus = true;
    let synthesizer = Synthesizer::new(&sound_font, &settings)
        .map_err(|error| format!("cannot create synthesizer: {error}"))?;
    let mut midi_file = Cursor::new(midi_bytes);
    let midi_file = Arc::new(
        MidiFile::new(&mut midi_file).map_err(|error| format!("cannot parse generated MIDI: {error}"))?,
    );
    let mut sequencer = MidiFileSequencer::new(synthesizer);
    sequencer.play(&midi_file, false);

    let sample_count = (spec.duration_seconds * SAMPLE_RATE as f64).round().max(1.0) as usize;
    let mut left = vec![0.0_f32; sample_count];
    let mut right = vec![0.0_f32; sample_count];
    sequencer.render(&mut left, &mut right);
    write_wav(&left, &right, output)?;
    Ok(midi_path)
}

fn load_template_catalog(path: &Path) -> Result<Value> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("cannot read template catalog {}: {error}", path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("invalid template catalog {}: {error}", path.display()))
}

fn load_templates() -> Result<Vec<Value>> {
    let root = project_root();
    let paths = [
        root.join("templates/index.json"),
        root.join("templates/public-domain/index.json"),
    ];
    let mut templates = Vec::new();
    for path in paths {
        let catalog = load_template_catalog(&path)?;
        if let Some(items) = catalog.get("templates").and_then(Value::as_array) {
            for item in items {
                let mut entry = item.clone();
                if let Some(object) = entry.as_object_mut() {
                    object.insert(
                        "catalog".to_string(),
                        json!(path.strip_prefix(&root).unwrap_or(&path)),
                    );
                }
                templates.push(entry);
            }
        }
    }
    Ok(templates)
}

fn command_templates(args: &[String]) -> Result<()> {
    let mut tag = None;
    let mut scene = None;
    let mut json_output = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--json" => json_output = true,
            "--tag" => {
                index += 1;
                tag = args.get(index).cloned();
            }
            "--scene" => {
                index += 1;
                scene = args.get(index).cloned();
            }
            other => return Err(format!("unknown templates option {other:?}")),
        }
        index += 1;
    }
    let items = load_templates()?;
    let selected: Vec<&Value> = items
        .iter()
        .filter(|item| {
            let tag_matches = tag
                .as_ref()
                .map(|wanted| {
                    item["tags"]
                        .as_array()
                        .map(|tags| tags.iter().any(|value| value.as_str() == Some(wanted)))
                        .unwrap_or(false)
                })
                .unwrap_or(true);
            let scene_matches = scene
                .as_ref()
                .map(|wanted| {
                    item["scene_tags"]
                        .as_array()
                        .or_else(|| item["tags"].as_array())
                        .map(|tags| tags.iter().any(|value| value.as_str() == Some(wanted)))
                        .unwrap_or(false)
                })
                .unwrap_or(true);
            tag_matches && scene_matches
        })
        .collect();
    if json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&selected).map_err(|error| error.to_string())?
        );
    } else {
        for item in selected {
            println!(
                "{}: {}",
                item["id"].as_str().unwrap_or("unknown"),
                item["description"].as_str().unwrap_or("")
            );
        }
    }
    Ok(())
}

fn command_template(args: &[String]) -> Result<()> {
    let mut template_id = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--json" => {}
            "--id" => {
                index += 1;
                template_id = args.get(index).cloned();
            }
            other => return Err(format!("unknown template option {other:?}")),
        }
        index += 1;
    }
    let wanted = template_id.ok_or_else(|| "template requires --id ID".to_string())?;
    let root = project_root();
    for catalog_path in [
        root.join("templates/index.json"),
        root.join("templates/public-domain/index.json"),
    ] {
        let catalog = load_template_catalog(&catalog_path)?;
        let Some(items) = catalog.get("templates").and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            if item["id"].as_str() != Some(wanted.as_str()) {
                continue;
            }
            let file_name = item["file"]
                .as_str()
                .ok_or_else(|| format!("template {wanted:?} has no file"))?;
            let dsl_path = catalog_path
                .parent()
                .ok_or_else(|| "template catalog has no parent directory".to_string())?
                .join(file_name);
            let dsl = fs::read_to_string(&dsl_path)
                .map_err(|error| format!("cannot read template DSL {}: {error}", dsl_path.display()))?;
            let mut result = item.clone();
            if let Some(object) = result.as_object_mut() {
                object.insert(
                    "catalog".to_string(),
                    json!(catalog_path.strip_prefix(&root).unwrap_or(&catalog_path)),
                );
                object.insert("dsl".to_string(), json!(dsl));
            }
            println!(
                "{}",
                serde_json::to_string(&result).map_err(|error| error.to_string())?
            );
            return Ok(());
        }
    }
    Err(format!("unknown music template {wanted:?}"))
}

fn command_doctor(args: &[String]) -> Result<i32> {
    let mut soundfont = default_soundfont();
    let mut json_output = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--json" => json_output = true,
            "--soundfont" => {
                index += 1;
                soundfont = PathBuf::from(
                    args.get(index)
                        .ok_or_else(|| "--soundfont needs a path".to_string())?,
                );
            }
            other => return Err(format!("unknown doctor option {other:?}")),
        }
        index += 1;
    }
    let exists = soundfont.is_file()
        && fs::metadata(&soundfont)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
            > 0;
    let report = json!({
        "project_root": project_root(),
        "rust": env!("CARGO_PKG_VERSION"),
        "soundfont": soundfont,
        "soundfont_exists": exists,
        "ready": exists,
    });
    if json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?
        );
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?
        );
    }
    Ok(if exists { 0 } else { 2 })
}

fn command_render(args: &[String]) -> Result<()> {
    let mut dsl = None;
    let mut output = None;
    let mut soundfont = default_soundfont();
    let mut keep_midi = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--dsl" => {
                index += 1;
                dsl = Some(
                    args.get(index)
                        .ok_or_else(|| "--dsl needs a path".to_string())?
                        .clone(),
                );
            }
            "--output" => {
                index += 1;
                output = Some(PathBuf::from(
                    args.get(index)
                        .ok_or_else(|| "--output needs a path".to_string())?,
                ));
            }
            "--soundfont" => {
                index += 1;
                soundfont = PathBuf::from(
                    args.get(index)
                        .ok_or_else(|| "--soundfont needs a path".to_string())?,
                );
            }
            "--keep-midi" => keep_midi = true,
            other => return Err(format!("unknown render option {other:?}")),
        }
        index += 1;
    }
    let dsl_path = dsl.ok_or_else(|| "render requires --dsl PATH".to_string())?;
    let output = output.ok_or_else(|| "render requires --output PATH".to_string())?;
    let text = if dsl_path == "-" {
        let mut buffer = String::new();
        io::stdin()
            .read_to_string(&mut buffer)
            .map_err(|error| error.to_string())?;
        buffer
    } else {
        fs::read_to_string(&dsl_path)
            .map_err(|error| format!("cannot read DSL {dsl_path:?}: {error}"))?
    };
    let document = parse_dsl(&text)?;
    let spec = compile_document(&document)?;
    let midi = render(&spec, &output, &soundfont, keep_midi)?;
    let mut result = json!({ "wav": output.canonicalize().unwrap_or(output.clone()), "duration_seconds": spec.duration_seconds });
    if let Some(path) = midi {
        result["midi"] = json!(path.canonicalize().unwrap_or(path));
    }
    println!(
        "{}",
        serde_json::to_string(&result).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn usage() {
    eprintln!("Usage: luna-bgm-worker <doctor|templates|template|render> [options]");
    eprintln!("  luna-bgm-worker doctor [--json] [--soundfont PATH]");
    eprintln!("  luna-bgm-worker templates [--json] [--tag TAG] [--scene SCENE]");
    eprintln!("  luna-bgm-worker template --id ID [--json]");
    eprintln!("  luna-bgm-worker render --dsl PATH --output PATH [--soundfont PATH] [--keep-midi]");
}

fn main() {
    let mut arguments = env::args().skip(1).collect::<Vec<_>>();
    if arguments.is_empty() {
        usage();
        std::process::exit(2);
    }
    let command = arguments.remove(0);
    let result = match command.as_str() {
        "doctor" => command_doctor(&arguments).and_then(|code| {
            if code != 0 {
                std::process::exit(code);
            }
            Ok(())
        }),
        "templates" => command_templates(&arguments),
        "template" => command_template(&arguments),
        "render" => command_render(&arguments),
        "help" | "--help" | "-h" => {
            usage();
            Ok(())
        }
        other => Err(format!("unknown command {other:?}")),
    };
    if let Err(error) = result {
        eprintln!("error: {error}");
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_decimal_duration_is_parsed_as_an_option() {
        let document = parse_dsl(
            r#"bgm 1
dur 1
bpm 120
ts 4/4
sec main 1
  ch C
  t d c9
    p off c d.25
"#,
        )
        .expect("template should parse");
        assert_eq!(document.sections[0].tracks[0].patterns[0].duration, Some(0.25));
        assert_eq!(document.sections[0].tracks[0].patterns[0].tokens, vec!["off", "c"]);
    }
}
