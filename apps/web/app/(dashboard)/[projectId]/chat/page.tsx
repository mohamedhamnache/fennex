"use client";

import { MainChat } from "@/components/chat/MainChat";

/** The Main Chat. One assistant on the surface, the whole AI company behind it. */
export default function ChatPage({ params }: { params: { projectId: string } }) {
  return (
    <div className="-m-4 h-[calc(100vh-4rem)] sm:-m-6 sm:h-[calc(100vh-4.5rem)]">
      <MainChat projectId={params.projectId} />
    </div>
  );
}
