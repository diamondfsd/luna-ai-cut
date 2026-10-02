import {
Check,
Plus,
Video
} from "@/icons/lucide-compat";
import {
MULTICAM_POLICY_PRESETS
} from "@openreel/core";
import { ToolcraftButton as Button,ToolcraftSelectableCard as SelectableCard,ToolcraftSelectControl as Selector,ToolcraftText as Text,ToolcraftNumberInputControl } from "@openreel/ui";
import React from "react";

import { GroupSection } from "./multicam-group-cards";
import { useMulticamController } from "./use-multicam-controller";

interface MultiCameraPanelProps { onClose?: () => void; }

export const MultiCameraPanel: React.FC<MultiCameraPanelProps> = () => {
  const {
    groups,
    expandedGroups,
    selectedClips,
    processingGroupId,
    groupStatus,
    overlapStrategy,
    setOverlapStrategy,
    overlapEscalation,
    setOverlapEscalation,
    minShotSeconds,
    setMinShotSeconds,
    maxShotSeconds,
    setMaxShotSeconds,
    includeTranscripts,
    setIncludeTranscripts,
    policyPreset,
    setPolicyPreset,
    availableClips,
    toggleGroup,
    handleCreateGroup,
    handleSelectAngle,
    handleRemoveAngle,
    handleRenameAngle,
    handleOffsetChange,
    handleSyncAudio,
    handleAutoEdit,
    handleAcceptCut,
    handleRejectCut,
    handleNudgeCut,
    handleExportOtio,
    handleExportOrma,
    handleFindSocialClips,
    handleImportManifest,
    handleExportManifest,
    handleDeleteGroup,
    toggleClipSelection
  } = useMulticamController();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Video size={16} className="text-primary" />
        <div className="flex-1 flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-fg">
            Multi-Camera Editing
          </span>
          <Text type="supporting" color="secondary" className="text-[9px] text-fg-3">
            Sync and switch between camera angles
          </Text>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-bg-2 p-2">
        <span className="text-[10px] font-medium text-fg-2">Automatic edit policy</span>
        <Selector
          label="Preset"
          size="sm"
          width="100%"
          value={policyPreset}
          onChange={(value) => {
            setPolicyPreset(value);
            if (value === "conversation" || value === "energetic" || value === "panel") {
              const preset = MULTICAM_POLICY_PRESETS[value];
              setOverlapStrategy(preset.strategy);
              setOverlapEscalation(preset.escalateTo);
            }
          }}
          options={[
            { label: "Custom", value: "custom" },
            { label: "Conversation", value: "conversation" },
            { label: "Energetic", value: "energetic" },
            { label: "Panel", value: "panel" },
          ]}
        />
        <Selector
          label="Overlapping speakers"
          size="sm"
          width="100%"
          value={overlapStrategy}
          onChange={(value) => {
            setPolicyPreset("custom");
            setOverlapStrategy(value);
          }}
          options={[
            { label: "Hold current camera", value: "hold" },
            { label: "Choose energy winner", value: "winner" },
            { label: "Participant priority", value: "priority" },
            { label: "Use wide shot", value: "wide" },
            { label: "Split active speakers", value: "composite" },
            { label: "Progressive PiP", value: "progressive" },
          ]}
        />
        <Selector
          label="Sustained overlap"
          size="sm"
          width="100%"
          value={overlapEscalation}
          onChange={(value) => {
            setPolicyPreset("custom");
            setOverlapEscalation(value);
          }}
          options={[
            { label: "Wide shot", value: "wide" },
            { label: "Energy winner", value: "winner" },
            { label: "Participant priority", value: "priority" },
            { label: "Split layout", value: "composite" },
            { label: "Progressive PiP", value: "progressive" },
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          <ToolcraftNumberInputControl
            label="Minimum shot"
            size="sm"
            value={minShotSeconds}
            min={0}
            max={30}
            step={0.1}
            unit="sec"
            onChange={(value) => setMinShotSeconds(value ?? 0)}
          />
          <ToolcraftNumberInputControl
            label="Maximum shot"
            size="sm"
            value={maxShotSeconds}
            min={0}
            max={120}
            step={1}
            unit="sec"
            onChange={(value) => setMaxShotSeconds(value ?? 0)}
          />
        </div>
        <Text type="supporting" color="secondary" className="block text-[9px] text-fg-3">
          Maximum shot length triggers a listener reaction or wide reset.
        </Text>
        <label className="flex items-center gap-2 text-[9px] text-fg-2">
          <input
            type="checkbox"
            checked={includeTranscripts}
            onChange={(event) => setIncludeTranscripts(event.target.checked)}
          />
          Add per-channel local Sherpa transcripts to the .orma artifact
        </label>
      </div>

      {groups.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-medium text-fg-2">
            Camera Groups
          </span>
          {groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              isExpanded={expandedGroups.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
              onSelectAngle={(angleId) => handleSelectAngle(group.id, angleId)}
              onRemoveAngle={(angleId) => handleRemoveAngle(group.id, angleId)}
              onRenameAngle={(angleId, name) =>
                handleRenameAngle(group.id, angleId, name)
              }
              onOffsetChange={(angleId, offset) =>
                handleOffsetChange(group.id, angleId, offset)
              }
              onSync={() => handleSyncAudio(group.id)}
              onAutoEdit={() => handleAutoEdit(group.id)}
              onAcceptCut={(switchId) => handleAcceptCut(group.id, switchId)}
              onRejectCut={(switchId) => handleRejectCut(group.id, switchId)}
              onNudgeCut={(switchId, delta) => handleNudgeCut(group.id, switchId, delta)}
              onExportOtio={() => handleExportOtio(group.id)}
              onExportOrma={() => void handleExportOrma(group.id)}
              onFindSocialClips={() => void handleFindSocialClips(group.id)}
              onImportManifest={(file) => void handleImportManifest(group.id, file)}
              onExportManifest={() => handleExportManifest(group.id)}
              onDelete={() => handleDeleteGroup(group.id)}
              isProcessing={processingGroupId === group.id}
              status={groupStatus[group.id]}
            />
          ))}
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-border">
        <span className="block text-[10px] font-medium text-fg-2">
          Create New Group
        </span>
        <Text type="supporting" color="secondary" className="block text-[9px] text-fg-3">
          Select 2+ video clips to create a multi-camera group
        </Text>

        {availableClips.length === 0 ? (
          <div className="text-center py-4">
            <Video
              size={24}
              className="mx-auto mb-2 text-fg-3 opacity-50"
            />
            <Text type="supporting" color="secondary" className="text-[10px] text-fg-3">
              Import video clips to use multi-camera editing
            </Text>
          </div>
        ) : (
          <>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {availableClips.map((clip) => (
                <SelectableCard
                  key={clip.id}
                  label={`${clip.name} ${clip.trackName}`}
                  isSelected={selectedClips.includes(clip.id)}
                  onChange={() => toggleClipSelection(clip.id)}
                  onClick={() => toggleClipSelection(clip.id)}
                  padding={2}
                  variant={selectedClips.includes(clip.id) ? "green" : "muted"}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${
                    selectedClips.includes(clip.id)
                      ? "bg-primary/20 border border-primary"
                      : "bg-bg-2 border border-transparent hover:border-primary/30"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center ${
                      selectedClips.includes(clip.id)
                        ? "bg-primary border-primary"
                        : "border-border"
                    }`}
                  >
                    {selectedClips.includes(clip.id) && (
                      <Check size={10} className="text-white" />
                    )}
                  </div>
                  <div className="flex-1">
                    <span className="text-[10px] text-fg">
                      {clip.name}
                    </span>
                    <span className="text-[8px] text-fg-3 ml-1">
                      ({clip.trackName})
                    </span>
                  </div>
                </SelectableCard>
              ))}
            </div>

            <Button
              label={`Create Group (${selectedClips.length} selected)`}
              variant="primary"
              icon={<Plus size={12} />}
              onClick={handleCreateGroup}
              isDisabled={selectedClips.length < 2}
              className={`w-full flex items-center justify-center gap-2 py-2 text-[10px] rounded-lg transition-colors ${
                selectedClips.length >= 2
                  ? "bg-primary text-white hover:bg-primary/90"
                  : "bg-bg-2 text-fg-3 cursor-not-allowed"
              }`}
            />
          </>
        )}
      </div>

      <Text type="supporting" color="secondary" className="text-[9px] text-fg-3 text-center">
        Automatic edits create an editable timeline track and undo in one step
      </Text>
    </div>
  );
};

export default MultiCameraPanel;
