"use client";

import { memo } from "react";
import { selectTask } from "@/src/state/actions";
import { selectGroupedByAssignee } from "@/src/state/selectors";
import { useBoardStore, useBoardStoreApi } from "@/src/state/store";
import styles from "./board.module.css";

export const AssigneeView = memo(function AssigneeView() {
  const groups = useBoardStore(selectGroupedByAssignee);
  const selectedId = useBoardStore((s) => s.selectedId);
  const store = useBoardStoreApi();

  return (
    <section className={styles.panel} aria-labelledby="assignee-heading">
      <h2 id="assignee-heading">By person</h2>
      <div className={styles.assigneeGroups}>
        {groups.map((group) => (
          <div key={group.assigneeId ?? "unassigned"} className={styles.group}>
            <h3 className={styles.subheading}>
              {group.name}{" "}
              <span className={styles.muted}>({group.tasks.length})</span>
            </h3>
            {group.tasks.length === 0 ? (
              <p className={styles.empty}>No tasks</p>
            ) : (
              <ul className={styles.groupList}>
                {group.tasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className={
                        selectedId === task.id
                          ? styles.groupItemSelected
                          : styles.groupItem
                      }
                      onClick={() => selectTask(store, task.id)}
                    >
                      <span>{task.title}</span>
                      <span className={styles.muted}>
                        {task.status.replace(/_/g, " ")} · {task.priority}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
});
