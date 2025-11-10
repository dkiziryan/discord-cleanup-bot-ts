export const ResultTile = ({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: string | number;
  monospace?: boolean;
}) => {
  return (
    <article className="result-tile">
      <span className="tile-label">{label}</span>
      <span className={`tile-value ${monospace ? "monospace" : ""}`}>{value}</span>
    </article>
  );
};
