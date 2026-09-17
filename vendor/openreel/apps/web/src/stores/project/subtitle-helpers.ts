import type { Project, Subtitle, SubtitleStyle } from "@openreel/core";

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Inter",
  fontSize: 24,
  color: "#ffffff",
  backgroundColor: "transparent",
  position: "bottom",
};

export const SUBTITLE_PRESETS: Record<string, Partial<SubtitleStyle>> = {
  default: {
    fontFamily: "Inter",
    fontSize: 24,
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    position: "bottom",
  },
  minimal: {
    fontFamily: "DM Sans",
    fontSize: 20,
    color: "#ffffff",
    backgroundColor: "transparent",
    position: "bottom",
  },
  bold: {
    fontFamily: "Bebas Neue",
    fontSize: 32,
    color: "#ffff00",
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    position: "bottom",
  },
  centered: {
    fontFamily: "Playfair Display",
    fontSize: 22,
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    position: "center",
  },
  modern: {
    fontFamily: "Poppins",
    fontSize: 24,
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    position: "bottom",
  },
  elegant: {
    fontFamily: "Cinzel",
    fontSize: 22,
    color: "#ffd700",
    backgroundColor: "transparent",
    position: "bottom",
  },
  casual: {
    fontFamily: "Quicksand",
    fontSize: 24,
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    position: "bottom",
  },
};

export function parseSRT(content: string): {
  subtitles: Subtitle[];
  errors: string[];
} {
  const subtitles: Subtitle[] = [];
  const errors: string[] = [];
  const blocks = content.trim().split(/\n\n+/);

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split("\n").filter((line) => line.trim());
    if (lines.length < 3) {
      errors.push(
        `Block ${i + 1}: Invalid format (needs index, timecode, and text)`,
      );
      continue;
    }

    const timecodeMatch = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (!timecodeMatch) {
      errors.push(`Block ${i + 1}: Invalid timecode format`);
      continue;
    }

    const startTime =
      parseInt(timecodeMatch[1]) * 3600 +
      parseInt(timecodeMatch[2]) * 60 +
      parseInt(timecodeMatch[3]) +
      parseInt(timecodeMatch[4]) / 1000;

    const endTime =
      parseInt(timecodeMatch[5]) * 3600 +
      parseInt(timecodeMatch[6]) * 60 +
      parseInt(timecodeMatch[7]) +
      parseInt(timecodeMatch[8]) / 1000;

    const text = lines.slice(2).join("\n");

    subtitles.push({
      id: `subtitle-${Date.now()}-${i}`,
      text,
      startTime,
      endTime,
      style: { ...DEFAULT_SUBTITLE_STYLE },
    });
  }

  return { subtitles, errors };
}

export function generateSRT(subtitles: Subtitle[]): string {
  const sortedSubtitles = [...subtitles].sort(
    (a, b) => a.startTime - b.startTime,
  );

  return sortedSubtitles
    .map((sub, index) => {
      const formatTime = (seconds: number): string => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.round((seconds % 1) * 1000);
        return `${h.toString().padStart(2, "0")}:${m
          .toString()
          .padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms
          .toString()
          .padStart(3, "0")}`;
      };

      return `${index + 1}\n${formatTime(sub.startTime)} --> ${formatTime(
        sub.endTime,
      )}\n${sub.text}`;
    })
    .join("\n\n");
}

export function addSubtitleToProject(
  project: Project,
  subtitle: Subtitle,
): Project {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      subtitles: [...project.timeline.subtitles, subtitle],
    },
    modifiedAt: Date.now(),
  };
}

export function removeSubtitleFromProject(
  project: Project,
  subtitleId: string,
): Project {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      subtitles: project.timeline.subtitles.filter((s) => s.id !== subtitleId),
    },
    modifiedAt: Date.now(),
  };
}

export function updateSubtitleInProject(
  project: Project,
  subtitleId: string,
  updates: Partial<Subtitle>,
): Project {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      subtitles: project.timeline.subtitles.map((s) =>
        s.id === subtitleId ? { ...s, ...updates } : s,
      ),
    },
    modifiedAt: Date.now(),
  };
}
