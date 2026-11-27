"use client";

import { memo, useEffect, useRef, useState } from "react";
import { MEMBERS } from "@/src/lib/members";
import { PRIORITIES, STATUSES, type Priority, type Status } from "@/src/lib/types";
import { deleteTask, updateTask } from "@/src/state/actions";
import { selectSelectedTask } from "@/src/state/selectors";
import { useBoardStore, useBoardStoreApi } from "@/src/state/store";
import styles from "./board.module.css";

export const TaskEditor = memo(function TaskEditor({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const task = useBoardStore(selectSelectedTask);
  const store = useBoardStoreApi();
  const [draft, setDraft] = useState("");
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [hadSelection, setHadSelection] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!task) {
      setDraft("");
      setChangedElsewhere(false);
      setEditingTitle(false);
      return;
    }
    setHadSelection(true);
    setDraft(task.title);
    setChangedElsewhere(false);
    // Reset draft only when the selected task identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  useEffect(() => {
    if (!task) return;
    if (editingTitle) {
      if (task.title !== draftRef.current) {
        setChangedElsewhere(true);
      }
    } else {
      setDraft(task.title);
      setChangedElsewhere(false);
    }
  }, [task?.title, task?.id, editingTitle, task]);

  const commitTitle = async () => {
    if (!task) return;
    if (draft.trim() === task.title) {
      setChangedElsewhere(false);
      return;
    }
    const err = await updateTask(store, task.id, { title: draft });
    onError(err?.message ?? null);
    if (!err) setChangedElsewhere(false);
  };

  if (!task) {
    return (
      <section
        className={styles.panel}
        role="region"
        aria-labelledby="editor-heading"
      >
        <h2 id="editor-heading">Editor</h2>
        <p className={styles.empty}>
          {hadSelection
            ? "Selected task was deleted."
            : "Select a task to edit."}
        </p>
      </section>
    );
  }

  return (
    <section
      className={styles.panel}
      role="region"
      aria-labelledby="editor-heading"
    >
      <h2 id="editor-heading">Editor</h2>
      <div className={styles.editorFields}>
        <label htmlFor="editor-title">Title</label>
        <input
          id="editor-title"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setEditingTitle(true)}
          onBlur={() => {
            setEditingTitle(false);
            void commitTitle();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setEditingTitle(false);
              void commitTitle();
            }
          }}
        />
        {changedElsewhere ? (
          <p className={styles.notice} role="status">
            Title changed elsewhere — your draft was kept.
          </p>
        ) : null}

        <label htmlFor="editor-assignee">Assignee</label>
        <select
          id="editor-assignee"
          value={task.assigneeId ?? ""}
          onChange={async (e) => {
            const value = e.target.value === "" ? null : e.target.value;
            const err = await updateTask(store, task.id, { assigneeId: value });
            onError(err?.message ?? null);
          }}
        >
          <option value="">Unassigned</option>
          {MEMBERS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <label htmlFor="editor-status">Status</label>
        <select
          id="editor-status"
          value={task.status}
          onChange={async (e) => {
            const err = await updateTask(store, task.id, {
              status: e.target.value as Status,
            });
            onError(err?.message ?? null);
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <label htmlFor="editor-priority">Priority</label>
        <select
          id="editor-priority"
          value={task.priority}
          onChange={async (e) => {
            const err = await updateTask(store, task.id, {
              priority: e.target.value as Priority,
            });
            onError(err?.message ?? null);
          }}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={styles.danger}
          onClick={async () => {
            const err = await deleteTask(store, task.id);
            onError(err?.message ?? null);
          }}
        >
          Delete task
        </button>
      </div>
    </section>
  );
});
