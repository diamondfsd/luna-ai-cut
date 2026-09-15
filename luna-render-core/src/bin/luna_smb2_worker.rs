use std::env;
use std::io::{self, Write};
use tokio::fs::File;
use tokio::io::AsyncReadExt;

const READ_BUFFER_SIZE: usize = 4 * 1024 * 1024;

fn required(name: &str) -> Result<String, String> {
    env::var(name).map_err(|_| format!("missing {name}"))
}

fn emit_progress(bytes: u64) {
    let _ = writeln!(io::stdout(), "{{\"bytes\":{bytes}}}");
    let _ = io::stdout().flush();
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host = required("LUNA_SMB_HOST")?;
    let port = env::var("LUNA_SMB_PORT").unwrap_or_else(|_| "445".to_string());
    let user = required("LUNA_SMB_USER")?;
    let password = required("LUNA_SMB_PASSWORD")?;
    let share = required("LUNA_SMB_SHARE")?;
    let source_path = required("LUNA_SMB_SOURCE")?;
    let remote_path = required("LUNA_SMB_REMOTE_PATH")?;

    let mut client = smb2::connect(&format!("{host}:{port}"), &user, &password).await?;
    let tree = client.connect_share(&share).await?;
    let mut writer = client.create_file_writer(&tree, &remote_path).await?;
    let mut source = File::open(source_path).await?;
    let mut buffer = vec![0u8; READ_BUFFER_SIZE];
    let mut total = 0u64;

    loop {
        let read = source.read(&mut buffer).await?;
        if read == 0 { break; }
        writer.write_chunk(&buffer[..read]).await?;
        total += read as u64;
        emit_progress(total);
    }

    writer.finish().await?;
    client.disconnect_share(&tree).await?;
    Ok(())
}
