"use client";

import { useState } from "react";

export function QuickAdd({
  onAdd,
  placeholder = "Add task",
}: {
  onAdd: (title: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const title = value.trim();
        if (!title) return;
        onAdd(title);
        setValue("");
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-subtle focus-visible:border-input"
      />
    </form>
  );
}
