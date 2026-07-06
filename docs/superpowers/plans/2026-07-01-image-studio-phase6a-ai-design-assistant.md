# Image Studio Phase 6A — AI Design Assistant (Chat-Based Editing)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **Dependency:** All editing service ops from Plan 2B. `call_llm` from `llm_service`. Edit page from Plan 2B (Phase 1 session).

**Goal:** Add a chat panel to the edit page where users type natural-language commands like "make it brighter", "remove the background", "add summer vibes". The AI interprets the command, maps it to an editing operation + params, and executes it immediately. Creates a version entry like any manual edit.

**Architecture:** New `POST /images/{id}/ai-command` endpoint: receives the text command + conversation history → calls LLM with a system prompt that knows all available operations + their params → parses the response into `{operation, params}` → calls the existing `editing_service` dispatcher → returns the resulting `GeneratedImage`. Frontend adds a chat panel below the canvas or as a floating drawer in the edit page.

**Tech Stack:** FastAPI, existing `call_llm` + `editing_service`, Next.js 14 App Router, TanStack Query v5

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- TypeScript: 0 errors
- TDD: write failing test first, then implement

---

### Task 1: AI command parsing service

**Files:**
- Create: `apps/api/app/services/ai_command_service.py`
- Test: `apps/api/tests/test_ai_command_service.py`

**Interfaces:**
- Produces: `parse_ai_command(command: str, history: list[dict], org_id, db) -> dict`
  - Returns `{"operation": str, "params": dict}` or `{"error": str}`

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_ai_command_service.py
import pytest
import uuid
from unittest.mock import AsyncMock, patch
from app.services.ai_command_service import parse_ai_command


@pytest.mark.asyncio
async def test_parse_make_brighter():
    with patch("app.services.ai_command_service.get_org_llm_keys", AsyncMock(return_value={"anthropic": "sk-test"})):
        with patch("app.services.ai_command_service.call_llm",
                   AsyncMock(return_value='{"operation": "adjust", "params": {"brightness": 40}}')):
            result = await parse_ai_command("make it brighter", [], uuid.uuid4(), db=None)
    assert result["operation"] == "adjust"
    assert result["params"]["brightness"] == 40


@pytest.mark.asyncio
async def test_parse_remove_background():
    with patch("app.services.ai_command_service.get_org_llm_keys", AsyncMock(return_value={"openai": "sk-test"})):
        with patch("app.services.ai_command_service.call_llm",
                   AsyncMock(return_value='{"operation": "background_removal", "params": {}}')):
            result = await parse_ai_command("remove the background", [], uuid.uuid4(), db=None)
    assert result["operation"] == "background_removal"


@pytest.mark.asyncio
async def test_parse_unknown_command():
    with patch("app.services.ai_command_service.get_org_llm_keys", AsyncMock(return_value={"anthropic": "sk-test"})):
        with patch("app.services.ai_command_service.call_llm",
                   AsyncMock(return_value='{"error": "I cannot perform this action on an image."}')):
            result = await parse_ai_command("book me a flight", [], uuid.uuid4(), db=None)
    assert "error" in result


@pytest.mark.asyncio
async def test_parse_no_llm_keys():
    with patch("app.services.ai_command_service.get_org_llm_keys", AsyncMock(return_value={})):
        result = await parse_ai_command("make brighter", [], uuid.uuid4(), db=None)
    assert result.get("error") == "no_llm_keys"
```

- [ ] **Step 2: Create ai_command_service.py**

```python
# apps/api/app/services/ai_command_service.py
"""Parse natural-language editing commands into structured operations using LLM."""
import json
import uuid
from app.services.llm_service import get_org_llm_keys, call_llm

_OPERATIONS_REFERENCE = """
Available operations (use exactly these names):
- crop: params: x(int), y(int), w(int), h(int) — pixel values
- resize: params: width(int), height(int), keep_aspect(bool, default true)
- rotate: params: angle(float, -180 to 180)
- adjust: params: brightness(float, -100 to 100), contrast(float, -100 to 100)
- filter: params: filter_name("grayscale"|"sepia"|"warm"|"cool"|"vivid")
- denoise: params: strength(float, 0 to 1)
- sharpen: params: strength(float, 0 to 1)
- background_removal: params: {} (no extra params)
- upscale: params: scale(2 or 4)
- restore_face: params: fidelity(float, 0 to 1, default 0.7)
- shadow: params: direction("bottom"|"bottom-right"|"bottom-left"|"right"|"left")
- relight: params: direction("top"|"top-right"|"left"|"right"), intensity(float, 0.1 to 2)

Operations requiring a mask (user must paint mask on canvas first):
- replace_background: params: prompt(str describing new background)
- remove_object: params: {}
- insert_object: params: prompt(str describing object to insert)
- generative_fill: params: prompt(str describing fill content)
- smart_erase: params: {}
"""

_SYSTEM = (
    "You are an AI image editing assistant. The user will describe an edit they want to make. "
    "Map their request to exactly one editing operation from the list below. "
    "Respond ONLY with a JSON object: {\"operation\": \"name\", \"params\": {...}}. "
    "If the request cannot be mapped to any operation, respond with {\"error\": \"explanation\"}. "
    "No markdown, no explanations outside the JSON.\n\n"
    + _OPERATIONS_REFERENCE
)

_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]


async def parse_ai_command(
    command: str,
    history: list[dict],
    org_id: uuid.UUID,
    db,
) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"error": "no_llm_keys"}

    # Build conversation context from history (last 6 turns)
    messages = []
    for turn in history[-6:]:
        messages.append({"role": turn.get("role", "user"), "content": turn.get("content", "")})
    messages.append({"role": "user", "content": command})

    user_msg = "\n".join(f"{m['role']}: {m['content']}" for m in messages[-3:]) if len(messages) > 1 else command

    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _SYSTEM, user_msg)
            data = json.loads(raw.strip())
            if "operation" in data or "error" in data:
                return data
        except Exception:
            continue

    return {"error": "Failed to parse command — please try rephrasing."}
```

- [ ] **Step 3: Run tests and commit**

```bash
cd apps/api && pytest tests/test_ai_command_service.py -v
git add apps/api/app/services/ai_command_service.py apps/api/tests/test_ai_command_service.py
git commit -m "feat(ai-assistant): add natural-language command parsing service"
```

---

### Task 2: AI command endpoint

**Files:**
- Create: `apps/api/app/api/v1/routers/ai_command.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_ai_command_api.py`

**Interfaces:**
- `POST /api/v1/images/{id}/ai-command` body: `{command: str, history: list[dict]}` → `ImageOut` (the new edited image)

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_ai_command_api.py
async def test_ai_command_adjust(client, auth_headers, sample_image):
    from unittest.mock import patch, AsyncMock
    with patch("app.api.v1.routers.ai_command.parse_ai_command",
               AsyncMock(return_value={"operation": "adjust", "params": {"brightness": 30}})):
        with patch("app.api.v1.routers.ai_command.adjust_image",
                   AsyncMock(return_value={"ok": True, "image_url": "https://s3.example.com/adjusted.png"})):
            response = await client.post(
                f"/api/v1/images/{sample_image.id}/ai-command",
                json={"command": "make it brighter", "history": []},
                headers=auth_headers,
            )
    assert response.status_code == 200
    assert response.json()["edit_operation"] == "adjust"


async def test_ai_command_unknown(client, auth_headers, sample_image):
    from unittest.mock import patch, AsyncMock
    with patch("app.api.v1.routers.ai_command.parse_ai_command",
               AsyncMock(return_value={"error": "Cannot book flights"})):
        response = await client.post(
            f"/api/v1/images/{sample_image.id}/ai-command",
            json={"command": "book me a flight", "history": []},
            headers=auth_headers,
        )
    assert response.status_code == 422
    assert "Cannot book flights" in response.json()["detail"]
```

- [ ] **Step 2: Create router**

```python
# apps/api/app/api/v1/routers/ai_command.py
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.models.image import GeneratedImage, ImageStatus
from app.services.ai_command_service import parse_ai_command
from app.services.editing_service import (
    crop_image, resize_image, rotate_image, adjust_image, apply_filter,
    denoise_image, sharpen_image, remove_background, replace_background,
    remove_object, insert_object, generative_fill, smart_erase,
    generate_shadow, relight_image, restore_face, upscale_image,
)
from app.api.v1.routers.images import ImageOut

router = APIRouter()

_DISPATCH = {
    "crop": lambda url, p, _: crop_image(url, **p),
    "resize": lambda url, p, _: resize_image(url, **p),
    "rotate": lambda url, p, _: rotate_image(url, **p),
    "adjust": lambda url, p, _: adjust_image(url, **p),
    "filter": lambda url, p, _: apply_filter(url, **p),
    "denoise": lambda url, p, _: denoise_image(url, **p),
    "sharpen": lambda url, p, _: sharpen_image(url, **p),
    "background_removal": lambda url, p, _: remove_background(url),
    "upscale": lambda url, p, _: upscale_image(url, p.get("scale", 2)),
    "restore_face": lambda url, p, _: restore_face(url, p.get("fidelity", 0.7)),
    "shadow": lambda url, p, _: generate_shadow(url, p.get("direction", "bottom")),
    "relight": lambda url, p, _: relight_image(url, p.get("direction", "top"), p.get("intensity", 1.0)),
    "replace_background": lambda url, p, mask: replace_background(url, mask or "", p.get("prompt", "")),
    "remove_object": lambda url, p, mask: remove_object(url, mask or ""),
    "insert_object": lambda url, p, mask: insert_object(url, mask or "", p.get("prompt", "")),
    "generative_fill": lambda url, p, mask: generative_fill(url, mask or "", p.get("prompt", "")),
    "smart_erase": lambda url, p, mask: smart_erase(url, mask or ""),
}


class AiCommandRequest(BaseModel):
    command: str
    history: list[dict] = []
    mask_base64: Optional[str] = None


@router.post("/{image_id}/ai-command", response_model=ImageOut)
async def ai_command(image_id: uuid.UUID, body: AiCommandRequest, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(GeneratedImage).where(GeneratedImage.id == image_id, GeneratedImage.org_id == current_user.org_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")

    parsed = await parse_ai_command(body.command, body.history, current_user.org_id, db)

    if "error" in parsed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, parsed["error"])

    operation = parsed.get("operation")
    params = parsed.get("params", {})

    if operation not in _DISPATCH:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown operation: {operation}")

    mask_url = None
    if body.mask_base64:
        from app.api.v1.routers.editing import _upload_mask
        mask_url = await _upload_mask(body.mask_base64, current_user.org_id)

    fn = _DISPATCH[operation]
    edit_result = await fn(source.image_url or "", params, mask_url)

    if not edit_result.get("ok"):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, edit_result.get("error", "Edit failed"))

    new_image = GeneratedImage(
        org_id=current_user.org_id,
        project_id=source.project_id,
        prompt=source.prompt,
        style=source.style,
        usage=source.usage,
        image_url=edit_result["image_url"],
        status=ImageStatus.ready,
        source_image_id=source.id,
        edit_operation=operation,
    )
    db.add(new_image)
    await db.flush()
    await db.refresh(new_image)
    await db.commit()
    return ImageOut.model_validate(new_image)
```

- [ ] **Step 3: Register, test, commit**

```python
# router.py:
from app.api.v1.routers import ai_command
api_router.include_router(ai_command.router, prefix="/images", tags=["ai-assistant"])
```

```bash
cd apps/api && pytest tests/test_ai_command_api.py -v
git add apps/api/app/api/v1/routers/ai_command.py apps/api/app/api/v1/router.py apps/api/tests/test_ai_command_api.py
git commit -m "feat(ai-assistant): add POST /images/{id}/ai-command endpoint"
```

---

### Task 3: Frontend — Chat panel in edit page

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/studio/edit/AiChatPanel.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx`

- [ ] **Step 1: Add API function**

```typescript
// apps/web/lib/api.ts

export interface AiCommandMessage {
  role: "user" | "assistant";
  content: string;
}

export async function sendAiCommand(
  imageId: string,
  command: string,
  history: AiCommandMessage[],
  maskBase64?: string,
): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>(`/images/${imageId}/ai-command`, {
    command,
    history,
    mask_base64: maskBase64 ?? null,
  });
}
```

- [ ] **Step 2: Create AiChatPanel**

```tsx
// apps/web/components/studio/edit/AiChatPanel.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Bot, User, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { sendAiCommand, type GeneratedImage, type AiCommandMessage } from "@/lib/api";

const SUGGESTIONS = [
  "Make it brighter",
  "Remove the background",
  "Make it more vibrant",
  "Sharpen the image",
  "Convert to grayscale",
  "Add a shadow below",
];

interface AiChatPanelProps {
  imageId: string;
  onVersionAdded: (img: GeneratedImage) => void;
}

export function AiChatPanel({ imageId, onVersionAdded }: AiChatPanelProps) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<AiCommandMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const mutation = useMutation({
    mutationFn: ({ command }: { command: string }) => sendAiCommand(imageId, command, history),
    onSuccess: (img, { command }) => {
      setHistory((prev) => [
        ...prev,
        { role: "user", content: command },
        { role: "assistant", content: `Applied: ${img.edit_operation?.replace(/_/g, " ")} ✓` },
      ]);
      onVersionAdded(img);
      setInput("");
    },
    onError: (err, { command }) => {
      setHistory((prev) => [
        ...prev,
        { role: "user", content: command },
        { role: "assistant", content: `Sorry, I couldn't do that: ${err instanceof Error ? err.message : "unknown error"}` },
      ]);
      setInput("");
    },
  });

  function submit(command: string) {
    if (!command.trim() || mutation.isPending) return;
    mutation.mutate({ command });
  }

  return (
    <div className="flex flex-col h-full">
      {/* History */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {history.length === 0 && (
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-primary" />
              Try a command:
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="text-left rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {history.map((msg, i) => (
          <div key={i} className={cn("flex gap-2 items-start", msg.role === "user" && "flex-row-reverse")}>
            <div className={cn(
              "h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-white",
              msg.role === "user" ? "bg-primary" : "bg-muted-foreground/30",
            )}>
              {msg.role === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3 text-foreground" />}
            </div>
            <div className={cn(
              "max-w-[80%] rounded-xl px-3 py-2 text-xs",
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-tr-none"
                : "bg-muted text-foreground rounded-tl-none",
            )}>
              {msg.content}
            </div>
          </div>
        ))}
        {mutation.isPending && (
          <div className="flex gap-2 items-center text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 flex gap-2 items-end shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); } }}
          placeholder='Try "make it warmer" or "remove background"…'
          rows={2}
          className="flex-1 resize-none rounded-lg border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="button"
          disabled={!input.trim() || mutation.isPending}
          onClick={() => submit(input)}
          className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add AiChatPanel to edit page**

In the edit page, add an "AI" toggle button in the header. When active, replace the EditControlsPanel with `<AiChatPanel>` (or show it as a collapsible drawer below the canvas). Pass `editTargetId` as `imageId` and `handleVersionAdded` as `onVersionAdded`.

- [ ] **Step 4: Typecheck, visual test, commit**

```bash
cd apps/web && npm run typecheck
# Test: type "make it grayscale" → image updates, new version appears in strip
git add apps/web/lib/api.ts apps/web/components/studio/edit/AiChatPanel.tsx apps/web/app/
git commit -m "feat(ai-assistant): add chat panel to edit page with natural-language commands"
```

---

## Self-Review

| Requirement | Task |
|---|---|
| Natural-language command parsing via LLM | Task 1 |
| Maps to all existing editing operations | Tasks 1, 2 |
| "Make this more premium" → lighting/color/contrast adjustments | Task 1 |
| "Remove background" → background_removal op | Task 1 |
| "Make it brighter" → adjust brightness | Task 1 |
| "Add summer vibe" → filter: warm | Task 1 |
| Creates new GeneratedImage (non-destructive) | Task 2 |
| Chat panel with conversation history | Task 3 |
| Quick-suggestion chips for first-time users | Task 3 |
| Mask support for generative operations | Task 2 |

All §10 requirements covered. ✓
