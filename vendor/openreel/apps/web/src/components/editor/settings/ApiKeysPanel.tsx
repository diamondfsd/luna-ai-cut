import React, { useState, useEffect, useCallback } from "react";
import {
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ExternalLink,
  Shield,
  KeyRound,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftLink as Link } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY } from "../../../stores/settings-store";
import {
  isMasterPasswordSet,
  isSessionUnlocked,
  setupMasterPassword,
  unlockSession,
  lockSession,
  saveSecret,
  getSecret,
  deleteSecret,
  hasSecret,
  listSecrets,
  changeMasterPassword,
} from "../../../services/secure-storage";
import { MasterPasswordDialog } from "./MasterPasswordDialog";
import { toast } from "../../../stores/notification-store";
import {
  getServiceDisplayDescription,
  getServiceDisplayLabel,
} from "./localization";

export const ApiKeysPanel: React.FC = () => {
  const { addConfiguredService, removeConfiguredService } =
    useSettingsStore();

  const [passwordSet, setPasswordSet] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [passwordDialogMode, setPasswordDialogMode] = useState<
    "setup" | "unlock" | "change" | null
  >(null);
  const [storedKeys, setStoredKeys] = useState<
    Array<{ id: string; label: string; createdAt: number; updatedAt: number }>
  >([]);
  const [addingService, setAddingService] = useState<string | null>(null);
  const [newKeyValue, setNewKeyValue] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const refreshState = useCallback(async () => {
    const isSet = await isMasterPasswordSet();
    setPasswordSet(isSet);
    setUnlocked(isSessionUnlocked());

    if (isSessionUnlocked()) {
      const keys =
        typeof window !== "undefined" && window.openreel?.platform === "desktop"
          ? (
              await Promise.all(
                SERVICE_REGISTRY.map(async (service) =>
                  (await hasSecret(service.id))
                    ? {
                        id: service.id,
                        label: service.label,
                        createdAt: 0,
                        updatedAt: 0,
                      }
                    : null,
                ),
              )
            ).filter((key): key is NonNullable<typeof key> => key !== null)
          : (await listSecrets()).filter((key) =>
              SERVICE_REGISTRY.some((service) => service.id === key.id),
            );
      setStoredKeys(keys);
    }
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  const handlePasswordSubmit = useCallback(
    async (password: string, newPassword?: string): Promise<boolean> => {
      if (passwordDialogMode === "setup") {
        await setupMasterPassword(password);
        setPasswordDialogMode(null);
        await refreshState();
        toast.success("主密码已设置", "你的 API 密钥将使用 AES-256-GCM 加密。");
        return true;
      }

      if (passwordDialogMode === "unlock") {
        const success = await unlockSession(password);
        if (success) {
          setPasswordDialogMode(null);
          await refreshState();
          toast.success("会话已解锁", "现在可以管理 API 密钥。");
        }
        return success;
      }

      if (passwordDialogMode === "change" && newPassword) {
        const success = await changeMasterPassword(password, newPassword);
        if (success) {
          setPasswordDialogMode(null);
          await refreshState();
          toast.success("密码已更改", "所有密钥已重新加密。");
        }
        return success;
      }

      return false;
    },
    [passwordDialogMode, refreshState],
  );

  const handleSaveKey = useCallback(
    async (serviceId: string) => {
      if (!newKeyValue.trim()) return;

      const service = SERVICE_REGISTRY.find((s) => s.id === serviceId);
      if (!service) return;

      try {
        await saveSecret(serviceId, service.label, newKeyValue.trim());
        addConfiguredService(serviceId);
        setNewKeyValue("");
        setAddingService(null);
        await refreshState();
        toast.success(`${getServiceDisplayLabel(service)} 密钥已保存`, "API 密钥已加密并存储。");
      } catch (err) {
        toast.error("保存失败", err instanceof Error ? err.message : "未知错误");
      }
    },
    [newKeyValue, addConfiguredService, refreshState],
  );

  const handleDeleteKey = useCallback(
    async (serviceId: string) => {
      const service = SERVICE_REGISTRY.find((s) => s.id === serviceId);
      try {
        await deleteSecret(serviceId);
        removeConfiguredService(serviceId);
        setRevealedKeys((prev) => {
          const next = { ...prev };
          delete next[serviceId];
          return next;
        });
        await refreshState();
        toast.success(`${service ? getServiceDisplayLabel(service) : serviceId} 密钥已移除`);
      } catch (err) {
        toast.error("删除失败", err instanceof Error ? err.message : "未知错误");
      }
    },
    [removeConfiguredService, refreshState],
  );

  const handleRevealKey = useCallback(async (serviceId: string) => {
    if (revealedKeys[serviceId]) {
      setShowKey((prev) => ({ ...prev, [serviceId]: !prev[serviceId] }));
      return;
    }

    try {
      const value = await getSecret(serviceId);
      if (value) {
        setRevealedKeys((prev) => ({ ...prev, [serviceId]: value }));
        setShowKey((prev) => ({ ...prev, [serviceId]: true }));
      }
    } catch (err) {
      toast.error("解密失败", err instanceof Error ? err.message : "未知错误");
    }
  }, [revealedKeys]);

  const handleLock = useCallback(() => {
    lockSession();
    setUnlocked(false);
    setStoredKeys([]);
    setRevealedKeys({});
    setShowKey({});
  }, []);

  const availableServices = SERVICE_REGISTRY.filter(
    (s) => !storedKeys.some((k) => k.id === s.id),
  );

  // Not set up yet
  if (!passwordSet) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Shield size={32} className="text-primary" aria-hidden />
        </div>
        <Text as="h3" type="large" weight="bold" display="block" className="mb-2">
          安全存储 API 密钥
        </Text>
        <Text as="p" type="supporting" color="secondary" display="block" className="mb-6 max-w-sm">
          设置主密码，以便在本地加密并存储 API 密钥。密钥将使用 AES-256-GCM
          加密，仅在向所选服务发起请求时发送。
        </Text>
        <Button
          label="设置主密码"
          onClick={() => setPasswordDialogMode("setup")}
          variant="primary"
          icon={<KeyRound size={16} aria-hidden />}
        />

        {passwordDialogMode && (
          <MasterPasswordDialog
            isOpen={!!passwordDialogMode}
            onClose={() => setPasswordDialogMode(null)}
            mode={passwordDialogMode}
            onSubmit={handlePasswordSubmit}
          />
        )}
      </div>
    );
  }

  // Locked
  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
          <Lock size={32} className="text-amber-500" aria-hidden />
        </div>
        <Text as="h3" type="large" weight="bold" display="block" className="mb-2">
          会话已锁定
        </Text>
        <Text as="p" type="supporting" color="secondary" display="block" className="mb-6 max-w-sm">
          输入主密码以查看和管理 API 密钥。
        </Text>
        <Button
          label="解锁"
          onClick={() => setPasswordDialogMode("unlock")}
          variant="primary"
          icon={<Unlock size={16} aria-hidden />}
        />

        {passwordDialogMode && (
          <MasterPasswordDialog
            isOpen={!!passwordDialogMode}
            onClose={() => setPasswordDialogMode(null)}
            mode={passwordDialogMode}
            onSubmit={handlePasswordSubmit}
          />
        )}
      </div>
    );
  }

  // Unlocked — full management UI
  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-primary" aria-hidden />
          <Text type="supporting" color="secondary">
            {storedKeys.length} 个密钥已存储
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Button
            label="更改密码"
            variant="secondary"
            size="sm"
            onClick={() => setPasswordDialogMode("change")}
            icon={<Key size={14} aria-hidden />}
          />
          <Button
            label="锁定"
            variant="secondary"
            size="sm"
            onClick={handleLock}
            icon={<Lock size={14} aria-hidden />}
          />
        </div>
      </div>

      {/* Stored keys list */}
      <div className="space-y-3">
        {storedKeys.map((stored) => {
          const service = SERVICE_REGISTRY.find((s) => s.id === stored.id);
          const isRevealed = showKey[stored.id] && revealedKeys[stored.id];
          const serviceLabel = service
            ? getServiceDisplayLabel(service)
            : stored.label;

          return (
            <Card
              key={stored.id}
              variant="muted"
              padding={4}
              className="border border-border"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-primary" aria-hidden />
                  <Text type="label" weight="bold">
                    {serviceLabel}
                  </Text>
                  {service?.docsUrl && (
                    <Link
                      label={`${serviceLabel} 文档`}
                      href={service.docsUrl}
                      isExternalLink
                      color="secondary"
                      className="text-text-muted hover:text-primary"
                    >
                      <ExternalLink size={12} aria-hidden />
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    label={isRevealed ? "隐藏密钥" : "显示密钥"}
                    onClick={() => handleRevealKey(stored.id)}
                    variant="ghost"
                    size="sm"
                    icon={isRevealed ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  />
                  <IconButton
                    label="删除密钥"
                    onClick={() => handleDeleteKey(stored.id)}
                    variant="destructive"
                    size="sm"
                    icon={<Trash2 size={14} aria-hidden />}
                  />
                </div>
              </div>

              {service && (
                <Text as="p" type="supporting" color="secondary" display="block" className="mb-2">
                  {getServiceDisplayDescription(service)}
                </Text>
              )}

              <Card variant="default" padding={2} className="font-mono text-xs text-text-secondary">
                {isRevealed
                  ? revealedKeys[stored.id]
                  : "••••••••••••••••••••••••••••••••"}
              </Card>

              <Text type="supporting" color="secondary" display="block" className="mt-2 text-[10px]">
                {stored.createdAt > 0
                  ? `添加于 ${new Date(stored.createdAt).toLocaleDateString("zh-CN")} · 更新于 ${new Date(stored.updatedAt).toLocaleDateString("zh-CN")}`
                  : "已安全存储在系统钥匙串中"}
              </Text>
            </Card>
          );
        })}
      </div>

      {/* Add new key */}
      {addingService ? (
        <Card variant="green" padding={4} className="border border-primary/30">
          <div className="flex items-center gap-2 mb-3">
            <Plus size={14} className="text-primary" aria-hidden />
            <Text type="label" weight="bold">
              添加{" "}
              {(() => {
                const service = SERVICE_REGISTRY.find((s) => s.id === addingService);
                const label = service ? getServiceDisplayLabel(service) : "";
                return service?.keyOptional ? `可选的 ${label} 密钥` : `${label} 密钥`;
              })()}
            </Text>
          </div>
          <ToolcraftTextInputControl
            label="API 密钥"
            isLabelHidden
            type="password"
            value={newKeyValue}
            onChange={setNewKeyValue}
            placeholder={
              SERVICE_REGISTRY.find((s) => s.id === addingService)?.keyOptional
                ? "若接口需要，请粘贴 API 密钥"
                : "在此粘贴 API 密钥"
            }
            hasAutoFocus
            width="100%"
            className="mb-3 font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button
              label="取消"
              variant="secondary"
              size="sm"
              onClick={() => {
                setAddingService(null);
                setNewKeyValue("");
              }}
            />
            <Button
              label="保存密钥"
              variant="primary"
              size="sm"
              onClick={() => handleSaveKey(addingService)}
              isDisabled={!newKeyValue.trim()}
            />
          </div>
        </Card>
      ) : availableServices.length > 0 ? (
        <div>
          <Text as="h3" type="label" weight="bold" color="secondary" display="block" className="mb-3">
            添加 API 密钥
          </Text>
          <div className="grid gap-2">
            {availableServices.map((service) => (
              <ClickableCard
                key={service.id}
                label={`添加${service.keyOptional ? "可选的 " : ""}${getServiceDisplayLabel(service)} API 密钥`}
                onClick={() => setAddingService(service.id)}
                padding={3}
                variant="default"
                className="border border-border"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="p-2 rounded-lg bg-background-tertiary">
                    <Plus size={14} className="text-primary" aria-hidden />
                  </div>
                  <div>
                    <Text type="label" weight="bold" display="block">
                      {getServiceDisplayLabel(service)}{service.keyOptional ? "（可选密钥）" : ""}
                    </Text>
                    <Text type="supporting" color="secondary" display="block">
                      {getServiceDisplayDescription(service)}
                    </Text>
                  </div>
                </div>
              </ClickableCard>
            ))}
          </div>
        </div>
      ) : null}

      {passwordDialogMode && (
        <MasterPasswordDialog
          isOpen={!!passwordDialogMode}
          onClose={() => setPasswordDialogMode(null)}
          mode={passwordDialogMode}
          onSubmit={handlePasswordSubmit}
        />
      )}
    </div>
  );
};
