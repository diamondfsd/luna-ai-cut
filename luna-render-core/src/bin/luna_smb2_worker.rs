use std::env;
use std::io::{self, Write};

use serde_json::{json, Value};
use smb2::{Error as SmbError, SmbClient, Tree};
use tokio::fs::File;
use tokio::io::AsyncReadExt;

const READ_BUFFER_SIZE: usize = 4 * 1024 * 1024;

fn required(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    env::var(name).map_err(|_| format!("missing {name}").into())
}

fn optional(name: &str) -> String {
    env::var(name).unwrap_or_default()
}

fn remote_path() -> String {
    optional("LUNA_SMB_REMOTE_PATH").replace('\\', "/")
}

fn emit(value: &Value) -> Result<(), Box<dyn std::error::Error>> {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer(&mut output, value)?;
    writeln!(output)?;
    output.flush()?;
    Ok(())
}

fn emit_progress(bytes: u64) -> Result<(), Box<dyn std::error::Error>> {
    emit(&json!({ "bytes": bytes }))
}

fn is_not_found(error: &SmbError) -> bool {
    matches!(
        error.status(),
        Some(status) if status == smb2::types::status::NtStatus::NO_SUCH_FILE
            || status == smb2::types::status::NtStatus::OBJECT_NAME_NOT_FOUND
            || status == smb2::types::status::NtStatus::OBJECT_PATH_NOT_FOUND
    )
}

async fn connect() -> Result<SmbClient, Box<dyn std::error::Error>> {
    let host = required("LUNA_SMB_HOST")?;
    let port = env::var("LUNA_SMB_PORT").unwrap_or_else(|_| "445".to_string());
    let user = required("LUNA_SMB_USER")?;
    let password = required("LUNA_SMB_PASSWORD")?;
    Ok(smb2::connect(&format!("{host}:{port}"), &user, &password).await?)
}

async fn connect_share(client: &mut SmbClient) -> Result<Tree, Box<dyn std::error::Error>> {
    let share = required("LUNA_SMB_SHARE")?;
    Ok(client.connect_share(&share).await?)
}

async fn list_directory(
    client: &mut SmbClient,
    tree: &mut Tree,
) -> Result<(), Box<dyn std::error::Error>> {
    let entries = client.list_directory(tree, &remote_path()).await?;
    let values = entries
        .into_iter()
        .filter(|entry| entry.name != "." && entry.name != "..")
        .map(|entry| {
            json!({
                "name": entry.name,
                "size": entry.size,
                "isDirectory": entry.is_directory,
            })
        })
        .collect::<Vec<_>>();
    emit(&Value::Array(values))
}

async fn stat(client: &mut SmbClient, tree: &mut Tree) -> Result<(), Box<dyn std::error::Error>> {
    match client.stat(tree, &remote_path()).await {
        Ok(info) => emit(&json!({
            "size": info.size,
            "isDirectory": info.is_directory,
        })),
        Err(error) if is_not_found(&error) => emit(&Value::Null),
        Err(error) => Err(error.into()),
    }
}

async fn ensure_directory(
    client: &mut SmbClient,
    tree: &mut Tree,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut current = String::new();
    for part in remote_path().split('/').filter(|part| !part.is_empty()) {
        current = if current.is_empty() {
            part.to_string()
        } else {
            format!("{current}/{part}")
        };
        match client.stat(tree, &current).await {
            Ok(info) if info.is_directory => continue,
            Ok(_) => return Err("NAS target path is not a directory".into()),
            Err(error) if is_not_found(&error) => {
                client.create_directory(tree, &current).await?;
            }
            Err(error) => return Err(error.into()),
        }
    }
    emit(&json!({ "ok": true }))
}

async fn copy_file(client: &mut SmbClient, tree: &Tree) -> Result<(), Box<dyn std::error::Error>> {
    let source_path = required("LUNA_SMB_SOURCE")?;
    let mut writer = client.create_file_writer(tree, &remote_path()).await?;
    let mut source = File::open(source_path).await?;
    let mut buffer = vec![0u8; READ_BUFFER_SIZE];
    let mut total = 0u64;

    loop {
        let read = source.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        writer.write_chunk(&buffer[..read]).await?;
        total += read as u64;
        emit_progress(total)?;
    }

    writer.finish().await?;
    emit(&json!({ "bytes": total }))
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let operation = env::args().nth(1).unwrap_or_default();
    let mut client = connect().await?;

    if operation == "list-shares" {
        let shares = client.list_shares().await?;
        let values = shares
            .into_iter()
            .map(|share| {
                json!({
                    "name": share.name,
                    "type": "disk",
                    "comment": share.comment,
                })
            })
            .collect::<Vec<_>>();
        return emit(&Value::Array(values));
    }

    let mut tree = connect_share(&mut client).await?;
    let result = match operation.as_str() {
        "list-directory" => list_directory(&mut client, &mut tree).await,
        "stat" => stat(&mut client, &mut tree).await,
        "ensure-directory" => ensure_directory(&mut client, &mut tree).await,
        "copy-file" => copy_file(&mut client, &tree).await,
        "rename" => {
            let target = required("LUNA_SMB_TARGET_PATH")?.replace('\\', "/");
            client.rename(&mut tree, &remote_path(), &target).await?;
            emit(&json!({ "ok": true }))
        }
        "remove" => {
            client.delete_file(&mut tree, &remote_path()).await?;
            emit(&json!({ "ok": true }))
        }
        _ => Err(format!("unsupported SMB operation: {operation}").into()),
    };
    let _ = client.disconnect_share(&tree).await;
    result
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    run().await
}
