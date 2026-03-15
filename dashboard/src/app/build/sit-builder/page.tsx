import SitBuilderWorkbench from "@/features/sit-builder/components/sit-builder-workbench";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SIT Builder"
};

export default function SitBuilderPage() {
  return <SitBuilderWorkbench />;
}
