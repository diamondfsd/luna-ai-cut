import React from "react";
import { TextSection, ShapeSection, SVGSection } from "../";
import { InspectorSection } from "../shell/InspectorSection";

export interface StyleTabProps {
  clipId: string;
  showTextSection: boolean;
  showShapeSection: boolean;
  showSVGSection: boolean;
}

export const StyleTab: React.FC<StyleTabProps> = ({
  clipId,
  showTextSection,
  showShapeSection,
  showSVGSection,
}) => {
  return (
    <>
      {showTextSection && (
        <InspectorSection title="文字属性" sectionId="text-properties">
          <TextSection clipId={clipId} />
        </InspectorSection>
      )}
      {showShapeSection && (
        <InspectorSection title="形状属性" sectionId="shape-properties">
          <ShapeSection clipId={clipId} />
        </InspectorSection>
      )}
      {showSVGSection && (
        <InspectorSection title="SVG 属性">
          <SVGSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
