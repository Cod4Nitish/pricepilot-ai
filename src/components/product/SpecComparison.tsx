import type { Offer, ProductSpec } from "@/lib/types";

const FIELDS: { key: keyof ProductSpec; label: string; fmt?: (v: unknown) => string }[] = [
  { key: "brand", label: "Brand" },
  { key: "model", label: "Model" },
  { key: "storageGb", label: "Storage", fmt: (v) => `${v} GB` },
  { key: "ramGb", label: "RAM", fmt: (v) => `${v} GB` },
  { key: "color", label: "Colour" },
  { key: "condition", label: "Condition" },
];

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "" && v !== "unknown";
}

/** Compares specs across offers. Only rows where at least one offer has a real value are shown; missing cells say "Not listed". */
export default function SpecComparison({ offers }: { offers: Offer[] }) {
  const rows = FIELDS.filter((f) => offers.some((o) => present(o.spec[f.key])));
  if (offers.length === 0) return null;
  if (rows.length === 0) {
    return <p className="text-sm text-muted">No specifications could be read from these listings, so none are compared.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">Specification comparison, only fields found on the listings</caption>
        <thead className="bg-surface2 text-xs text-muted">
          <tr>
            <th scope="col" className="p-3">Spec</th>
            {offers.map((o) => (
              <th key={o.id} scope="col" className="p-3">{o.retailerName}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.key} className="border-t border-line">
              <th scope="row" className="p-3 font-medium text-muted">{f.label}</th>
              {offers.map((o) => {
                const v = o.spec[f.key];
                return (
                  <td key={o.id} className="p-3 capitalize">
                    {present(v) ? (f.fmt ? f.fmt(v) : String(v)) : <span className="normal-case text-muted">Not listed</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
