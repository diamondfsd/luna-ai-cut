import React from "react";
import {
  KeyframesSection,
  ClipTransitionSection,
  MotionPresetsPanel,
  MotionPathSection,
  EmphasisAnimationSection,
  TextAnimationSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";

export interface AnimateTabProps {
  clipId: string;
  clipType: string | null;
  showTextSection: boolean;
}

export const AnimateTab: React.FC<AnimateTabProps> = ({
  clipId,
  clipType,
  showTextSection,
}) => {
  return (
    <>
      <InspectorSection title="关键帧" sectionId="keyframes">
        <KeyframesSection clipId={clipId} />
      </InspectorSection>
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title="转场"
          sectionId="transitions"
          defaultOpen={false}
        >
          <ClipTransitionSection clipId={clipId} />
        </InspectorSection>
      )}
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title="动效预设"
          sectionId="motion-presets"
          defaultOpen={false}
        >
          <MotionPresetsPanel clipId={clipId} />
        </InspectorSection>
      )}
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title="动效路径"
          sectionId="motion-path"
          defaultOpen={false}
        >
          <MotionPathSection clipId={clipId} />
        </InspectorSection>
      )}
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") && (
        <InspectorSection
          title="强调动画"
          sectionId="emphasis-animation"
          defaultOpen={false}
        >
          <EmphasisAnimationSection clipId={clipId} />
        </InspectorSection>
      )}
      {showTextSection && (
        <InspectorSection
          title="文字动画"
          sectionId="text-animation"
          defaultOpen={false}
        >
          <TextAnimationSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
