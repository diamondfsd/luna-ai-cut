import React, { useState, useCallback } from "react";
import { Lock, Eye, EyeOff, ShieldCheck, AlertTriangle } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";

interface MasterPasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "setup" | "unlock" | "change";
  onSubmit: (password: string, newPassword?: string) => Promise<boolean>;
}

export const MasterPasswordDialog: React.FC<MasterPasswordDialogProps> = ({
  isOpen,
  onClose,
  mode,
  onSubmit,
}) => {
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowNewPassword(false);
    setError(null);
    setLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "setup") {
      if (password.length < 8) {
        setError("密码至少需要 8 个字符");
        return;
      }
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致");
        return;
      }
    }

    if (mode === "change") {
      if (newPassword.length < 8) {
        setError("新密码至少需要 8 个字符");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("两次输入的新密码不一致");
        return;
      }
    }

    setLoading(true);
    try {
      const success = await onSubmit(
        password,
        mode === "change" ? newPassword : undefined,
      );
      if (success) {
        resetForm();
      } else {
        setError(
          mode === "unlock"
            ? "密码错误"
            : "操作失败，请检查当前密码。",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "发生错误");
    } finally {
      setLoading(false);
    }
  }, [mode, password, newPassword, confirmPassword, onSubmit, resetForm]);

  const titles = {
    setup: "设置主密码",
    unlock: "解锁设置",
    change: "更改主密码",
  };

  const descriptions = {
    setup: "创建主密码以加密 API 密钥。密码不会被存储，只会保留验证哈希。",
    unlock: "输入主密码以访问已加密的 API 密钥。",
    change: "更改主密码，所有已存储的密钥都会重新加密。",
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      width={448}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={titles[mode]}
            subtitle={descriptions[mode]}
            onOpenChange={(open) => !open && handleClose()}
            startContent={<Lock size={18} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
        <form id="master-password-form" onSubmit={handleSubmit} className="space-y-4">
          {mode === "change" && (
            <div className="space-y-2">
              <div className="relative">
                <ToolcraftTextInputControl
                  label="当前密码"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder="输入当前密码"
                  hasAutoFocus
                  width="100%"
                  className="pr-10"
                />
                <IconButton
                  label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword(!showPassword)}
                  variant="ghost"
                  size="sm"
                  icon={showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                />
              </div>
            </div>
          )}

          {(mode === "setup" || mode === "unlock") && (
            <div className="space-y-2">
              <div className="relative">
                <ToolcraftTextInputControl
                  label={mode === "setup" ? "密码" : "主密码"}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder={
                    mode === "setup"
                      ? "至少 8 个字符"
                      : "输入主密码"
                  }
                  hasAutoFocus
                  width="100%"
                  className="pr-10"
                />
                <IconButton
                  label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword(!showPassword)}
                  variant="ghost"
                  size="sm"
                  icon={showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                />
              </div>
            </div>
          )}

          {(mode === "setup" || mode === "change") && (
            <>
              <div className="space-y-2">
                <div className="relative">
                  <ToolcraftTextInputControl
                    label={mode === "change" ? "新密码" : "确认密码"}
                    type={showNewPassword ? "text" : "password"}
                    value={mode === "change" ? newPassword : confirmPassword}
                    onChange={(value) =>
                      mode === "change"
                        ? setNewPassword(value)
                        : setConfirmPassword(value)
                    }
                    placeholder={
                      mode === "change"
                        ? "至少 8 个字符"
                        : "再次输入密码"
                    }
                    width="100%"
                    className="pr-10"
                  />
                  <IconButton
                    label={showNewPassword ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    variant="ghost"
                    size="sm"
                    icon={showNewPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  />
                </div>
              </div>

              {mode === "change" && (
                <div className="space-y-2">
                  <ToolcraftTextInputControl
                    label="确认新密码"
                    type={showNewPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="再次输入新密码"
                    width="100%"
                  />
                </div>
              )}
            </>
          )}

          {error && (
            <Card variant="red" padding={2} className="flex items-center gap-2 bg-error/10 text-sm text-error">
              <AlertTriangle size={14} />
              {error}
            </Card>
          )}

          {mode === "setup" && (
            <Card variant="muted" padding={2} className="flex items-start gap-2 bg-background-secondary">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
              <Text type="supporting" color="secondary" className="text-xs">
                密码会通过 PBKDF2（100k 次迭代）生成加密密钥。API 密钥使用
                AES-256-GCM 加密。忘记密码后将无法恢复已存储的密钥。
              </Text>
            </Card>
          )}
        </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex justify-end gap-2">
              <Button
                label="取消"
                variant="secondary"
                onClick={handleClose}
                isDisabled={loading}
              />
              <Button
                label={
                  loading
                    ? "处理中…"
                    : mode === "setup"
                      ? "设置密码"
                      : mode === "unlock"
                        ? "解锁"
                        : "更改密码"
                }
                type="submit"
                form="master-password-form"
                isDisabled={loading}
                variant="primary"
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
