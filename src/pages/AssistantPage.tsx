import React from "react";
import AppShell from "../components/layout/AppShell";
import ChatPanel from "../components/chat/ChatPanel";
import { PageHeader } from "../components/ui";

export default function AssistantPage() {
  return (
    <AppShell>
      <PageHeader
        title="Ask Baha AI"
        subtitle="Flood-safety questions in English or Filipino. Answers are grounded on DRRM-verified flood zones, road conditions, alerts, advisories and evacuation centers."
      />
      <div className="assistant-wrap">
        <ChatPanel />
      </div>
    </AppShell>
  );
}
