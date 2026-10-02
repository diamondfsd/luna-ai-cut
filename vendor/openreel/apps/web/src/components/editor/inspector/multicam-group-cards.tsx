import {
Camera,
Check,
ChevronDown,
ChevronRight,
Link,
Sparkles,
Trash2
} from "@/icons/lucide-compat";
import {
type CameraAngle,
type MultiCamGroup
} from "@openreel/core";
import { ToolcraftButton as Button,ToolcraftIconButton as IconButton,ToolcraftText as Text,ToolcraftNumberInputControl,ToolcraftTextInputControl } from "@openreel/ui";
import React,{ useState } from "react";

const AngleCard: React.FC<{
  angle: CameraAngle;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onOffsetChange: (offset: number) => void;
}> = ({ angle, isActive, onSelect, onRename, onRemove, onOffsetChange }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(angle.name);

  const handleSave = () => {
    onRename(editName);
    setIsEditing(false);
  };

  return (
    <div
      className={`p-2 rounded-lg border transition-colors cursor-pointer ${
        isActive
          ? "bg-primary/20 border-primary"
          : "bg-bg-2 border-border hover:border-primary/50"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: angle.color }}
        />
        {isEditing ? (
          <ToolcraftTextInputControl
            label="Camera angle name"
            isLabelHidden
            value={editName}
            onChange={setEditName}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 px-1 py-0.5 text-[10px] bg-bg-1 rounded border border-primary focus:outline-none"
            hasAutoFocus
          />
        ) : (
          <span
            className="flex-1 text-[10px] font-medium text-fg"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {angle.name}
          </span>
        )}
        {isActive && <Check size={12} className="text-primary" />}
        <IconButton
          label="Remove angle"
          icon={<Trash2 size={10} />}
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1 text-fg-3 hover:text-red-400 transition-colors"
        />
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span className="text-[8px] text-fg-3">Offset:</span>
        <ToolcraftNumberInputControl
          label="Angle offset"
          isLabelHidden
          size="sm"
          value={Number(angle.offset.toFixed(2))}
          onChange={(value) => onOffsetChange(value || 0)}
          onClick={(e) => e.stopPropagation()}
          className="w-16 px-1 py-0.5 text-[8px] bg-bg-1 rounded border border-border focus:border-primary focus:outline-none"
          step={0.1}
        />
        <span className="text-[8px] text-fg-3">sec</span>
      </div>
    </div>
  );
};

export const GroupSection: React.FC<{
  group: MultiCamGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectAngle: (angleId: string) => void;
  onRemoveAngle: (angleId: string) => void;
  onRenameAngle: (angleId: string, name: string) => void;
  onOffsetChange: (angleId: string, offset: number) => void;
  onSync: () => void;
  onAutoEdit: () => void;
  onAcceptCut: (switchId: string) => void;
  onRejectCut: (switchId: string) => void;
  onNudgeCut: (switchId: string, deltaSeconds: number) => void;
  onExportOtio: () => void;
  onExportOrma: () => void;
  onFindSocialClips: () => void;
  onImportManifest: (file: File) => void;
  onExportManifest: () => void;
  onDelete: () => void;
  isProcessing: boolean;
  status?: string;
}> = ({
  group,
  isExpanded,
  onToggle,
  onSelectAngle,
  onRemoveAngle,
  onRenameAngle,
  onOffsetChange,
  onSync,
  onAutoEdit,
  onAcceptCut,
  onRejectCut,
  onNudgeCut,
  onExportOtio,
  onExportOrma,
  onFindSocialClips,
  onImportManifest,
  onExportManifest,
  onDelete,
  isProcessing,
  status,
}) => (
  <div className="border border-border rounded-lg overflow-hidden">
    <Button
      label={group.name}
      variant="ghost"
      onClick={onToggle}
      className="w-full flex items-center gap-2 p-2 bg-bg-2 hover:bg-bg-1 transition-colors"
    >
      {isExpanded ? (
        <ChevronDown size={12} className="text-fg-3" />
      ) : (
        <ChevronRight size={12} className="text-fg-3" />
      )}
      <Camera size={12} className="text-primary" />
      <span className="flex-1 text-left text-[10px] font-medium text-fg">
        {group.name}
      </span>
      <span className="text-[9px] text-fg-3">
        {group.angles.length} angles
      </span>
    </Button>
    {isExpanded && (
      <div className="p-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {group.angles.map((angle) => (
            <AngleCard
              key={angle.id}
              angle={angle}
              isActive={angle.id === group.activeAngleId}
              onSelect={() => onSelectAngle(angle.id)}
              onRename={(name) => onRenameAngle(angle.id, name)}
              onRemove={() => onRemoveAngle(angle.id)}
              onOffsetChange={(offset) => onOffsetChange(angle.id, offset)}
            />
          ))}
        </div>
        <div className="flex gap-1 pt-2 border-t border-border">
          <Button
            label="Sync Audio"
            variant="ghost"
            icon={<Link size={10} />}
            onClick={onSync}
            isDisabled={isProcessing}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] text-fg-2 hover:text-fg bg-bg-2 rounded transition-colors"
          />
          <Button
            label="Auto Edit"
            variant="primary"
            icon={<Sparkles size={10} />}
            onClick={onAutoEdit}
            isLoading={isProcessing}
            isDisabled={group.angles.length < 2}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] rounded transition-colors"
          />
          <IconButton
            label="Delete camera group"
            icon={<Trash2 size={10} />}
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="flex items-center justify-center gap-1 px-2 py-1.5 text-[9px] text-red-400 hover:bg-red-400/10 rounded transition-colors"
          />
        </div>
        <div className="flex gap-1">
          <label className="flex-1 cursor-pointer rounded bg-bg-2 py-1 text-center text-[8px] text-fg-2 hover:text-fg">
            Import manifest
            <input
              type="file"
              accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportManifest(file);
                event.target.value = "";
              }}
            />
          </label>
          {group.manifest && (
            <Button
              label="Export manifest"
              variant="ghost"
              onClick={onExportManifest}
              className="flex-1 py-1 text-[8px]"
            />
          )}
        </div>
        {status && (
          <Text type="supporting" color="secondary" className="block text-[9px] text-fg-3">
            {status}
          </Text>
        )}
        {(group.switches?.length ?? 0) > 0 && (
          <div className="space-y-1 rounded-md border border-border bg-bg-1 p-2">
            <div className="flex items-center justify-between text-[9px]">
              <span className="font-medium text-fg-2">Cut review</span>
              <span className="text-fg-3">
                {Math.max(0, (group.switches?.length ?? 1) - 1)} cuts
              </span>
            </div>
            <div className="max-h-28 space-y-1 overflow-y-auto">
              {(group.switches ?? []).map((switchItem, switchIndex) => {
                const angle = group.angles.find((item) => item.id === switchItem.angleId);
                return (
                  <div
                    key={switchItem.id}
                    className="grid grid-cols-[42px_1fr_auto] items-center gap-1 text-[8px] text-fg-3"
                  >
                    <span>{switchItem.time.toFixed(2)}s</span>
                    <span className="truncate text-fg-2">{angle?.name ?? switchItem.angleId}</span>
                    <span className="text-right">
                      {switchItem.reason?.replaceAll("-", " ") ?? "manual"}
                      {switchItem.confidence !== undefined
                        ? ` · ${Math.round(switchItem.confidence * 100)}%`
                        : ""}
                    </span>
                    {switchIndex > 0 && (
                      <div className="col-span-3 flex items-center justify-end gap-1">
                        <Button
                          label="−100 ms"
                          variant="ghost"
                          onClick={() => onNudgeCut(switchItem.id, -0.1)}
                          className="px-1 py-0.5 text-[8px]"
                        />
                        <Button
                          label="+100 ms"
                          variant="ghost"
                          onClick={() => onNudgeCut(switchItem.id, 0.1)}
                          className="px-1 py-0.5 text-[8px]"
                        />
                        <Button
                          label="Reject"
                          variant="ghost"
                          onClick={() => onRejectCut(switchItem.id)}
                          className="px-1 py-0.5 text-[8px] text-red-400"
                        />
                        <Button
                          label={switchItem.reviewStatus === "accepted" ? "Accepted" : "Accept"}
                          variant="ghost"
                          onClick={() => onAcceptCut(switchItem.id)}
                          isDisabled={switchItem.reviewStatus === "accepted"}
                          className="px-1 py-0.5 text-[8px] text-emerald-400"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Text type="supporting" color="secondary" className="block text-[8px] text-fg-3">
              The generated output track remains fully editable on the timeline.
            </Text>
          </div>
        )}
        {group.manifest && group.shotPlan && (
          <div className="flex gap-1 border-t border-border pt-2">
            <Button
              label="Export OTIO"
              variant="ghost"
              onClick={onExportOtio}
              className="flex-1 py-1 text-[8px]"
            />
            <Button
              label="Export .orma"
              variant="ghost"
              onClick={onExportOrma}
              className="flex-1 py-1 text-[8px]"
            />
            <Button
              label="Find clips"
              variant="ghost"
              onClick={onFindSocialClips}
              className="flex-1 py-1 text-[8px]"
            />
          </div>
        )}
      </div>
    )}
  </div>
);

