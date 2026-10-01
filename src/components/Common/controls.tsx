import type { ChangeEvent, ReactNode } from 'react';

/** Labelled slider row used throughout the Inspector. */
export const Slider = ({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) => (
  <label className="oc-field">
    <span className="oc-field-label">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
    <span className="oc-field-value">{format ? format(value) : value.toFixed(2)}</span>
  </label>
);

/** Labelled colour input. */
export const ColorField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) => (
  <label className="oc-field">
    <span className="oc-field-label">{label}</span>
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
  </label>
);

/** Labelled select. */
export const Select = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) => (
  <label className="oc-field">
    <span className="oc-field-label">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
);

/** Checkbox row. */
export const Checkbox = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <label className="oc-field oc-field-inline">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className="oc-field-label">{label}</span>
  </label>
);

/** Section container for grouping Inspector panels. */
export const Panel = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="oc-panel">
    <h3 className="oc-panel-title">{title}</h3>
    {children}
  </section>
);

/** Hidden file input driven by a button. */
export const FileButton = ({
  label,
  accept,
  multiple,
  onFiles,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}) => {
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onFiles(files);
    // Reset so selecting the same file twice still fires a change event.
    e.target.value = '';
  };
  return (
    <>
      <label className="oc-btn" style={{ cursor: 'pointer' }}>
        {label}
        <input type="file" accept={accept} multiple={multiple} hidden onChange={handle} />
      </label>
    </>
  );
};
