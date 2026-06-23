export function SkeletonRow({ cols = 4 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}>
          <div className="skeleton" style={{ width: i === 0 ? '60%' : '40%', height: 12 }} />
        </td>
      ))}
    </tr>
  );
}
