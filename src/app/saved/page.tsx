import type { Metadata } from "next";
import SavedListView from "./SavedListView";

export const metadata: Metadata = { title: "Saved" };

export default function SavedPage() {
  return <SavedListView />;
}
