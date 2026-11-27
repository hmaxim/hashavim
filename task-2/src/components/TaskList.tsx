"use client";

import { memo, useState } from "react";
import { MEMBERS } from "@/src/lib/members";
import { PRIORITIES, STATUSES, type Priority, type Status } from "@/src/lib/types";
import {
  addTask,
  deleteTask,
  selectTask,
  updateTask,
} from "@/src/state/actions";
import { selectOrderedTasks } from "@/src/state/selectors";
import { useBoardStore, useBoardStoreApi } from "@/src/state/store";
import styles from "./board.module.css";

export const TaskList = memo(function TaskList({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const tasks = useBoardStore(selectOrderedTasks);
  const selectedId = useBoardStore((s) => s.selectedId);
  const store = useBoardStoreApi();
  const [title, setTitle] = useState("");

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = await addTask(store, { title });
    if (err) {
      onError(err.message);
      return;
    }
    onError(null);
    setTitle("");
  };

  return (
    <section className={styles.panel} role="region" aria-labelledby="list-heading">
      <h2 id="list-heading">Tasks</h2>
      <form className={styles.addForm} onSubmit={onAdd}>
        <label className={styles.srOnly} htmlFor="new-task-title">
          New task title
        </label>
        <input
          id="new-task-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          required
          maxLength={120}
        />
        <button type="submit">Add task</button>
      </form>

      {tasks.length === 0 ? (
        <p className={styles.empty}>No tasks on the board.</p>
      ) : (
        <ul className={styles.taskList}>
          {tasks.map((task) => (
            <li
              key={task.id}
              className={
                selectedId === task.id ? styles.taskRowSelected : styles.taskRow
              }
            >
              <button
                type="button"
                className={styles.taskTitleBtn}
                onClick={() => selectTask(store, task.id)}
              >
                {task.title}
              </button>
              <label className={styles.srOnly} htmlFor={`assignee-${task.id}`}>
                Assignee for {task.title}
              </label>
              <select
                id={`assignee-${task.id}`}
                value={task.assigneeId ?? ""}
                onChange={async (e) => {
                  const value = e.target.value === "" ? null : e.target.value;
                  const err = await updateTask(store, task.id, {
                    assigneeId: value,
                  });
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
              <label className={styles.srOnly} htmlFor={`status-${task.id}`}>
                Status for {task.title}
              </label>
              <select
                id={`status-${task.id}`}
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
              <label className={styles.srOnly} htmlFor={`priority-${task.id}`}>
                Priority for {task.title}
              </label>
              <select
                id={`priority-${task.id}`}
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
                aria-label={`Delete ${task.title}`}
                onClick={async () => {
                  const err = await deleteTask(store, task.id);
                  onError(err?.message ?? null);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
