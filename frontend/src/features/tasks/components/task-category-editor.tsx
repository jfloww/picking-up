"use client";

import { useId } from "react";

export function TaskCategoryEditor({
  category,
  categories,
  onCategoryChange,
}: {
  category: string;
  categories: string[];
  onCategoryChange: (category: string) => void;
}) {
  const listId = useId();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-subtle">Category</span>
      <input
        type="text"
        list={listId}
        defaultValue={category}
        onBlur={(e) => {
          const trimmed = e.target.value.trim();
          if (trimmed && trimmed !== category) onCategoryChange(trimmed);
        }}
        aria-label="Category"
        className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <datalist id={listId}>
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </label>
  );
}
