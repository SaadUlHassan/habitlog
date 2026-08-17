type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
};

export function SearchInput({ value, onChange, resultCount }: SearchInputProps) {
  return (
    <div className="search">
      {/* A real label rather than a placeholder. A placeholder disappears the moment
          you type and is not reliably announced, so it is not a substitute. */}
      <label className="search__label" htmlFor="habit-search">
        Filter habits
      </label>
      <input
        id="habit-search"
        className="search__input"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. water"
        autoComplete="off"
      />
      {/* Announced politely so filtering is perceivable without seeing the list move. */}
      <p className="search__status" role="status" aria-live="polite">
        {value.trim() === ""
          ? `${resultCount} habits`
          : `${resultCount} matching “${value.trim()}”`}
      </p>
    </div>
  );
}
