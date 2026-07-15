use std::process::Command;

/// Creates a media tool process without exposing a console window on Windows.
pub(crate) fn command(program: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        return command;
    }

    #[cfg(not(target_os = "windows"))]
    Command::new(program)
}
