interface Props {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}

/** An on/off switch with its label. A real checkbox underneath, so keyboard and screen readers work. */
export default function Toggle({ id, checked, onChange, children, disabled }: Props): React.JSX.Element {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">{children}</span>
    </label>
  );
}
