import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import type { Formatter } from "@/lib/format";
import type { DocumentRow } from "@/lib/services/documents";
import { StatusBadge, Table, Td, Th } from "./ui";

export function DocumentTable({ rows, t, fmt, showCustomer = true }: { rows: DocumentRow[]; t: Dictionary; fmt: Formatter; showCustomer?: boolean }) {
  const isInvoice = rows[0]?.kind === "invoice";
  return (
    <Table>
      <thead>
        <tr>
          <Th>{t.documents.number}</Th>
          {showCustomer && <Th className="hidden sm:table-cell">{t.common.customer}</Th>}
          <Th className="hidden sm:table-cell">{t.documents.issueDate}</Th>
          <Th className="hidden md:table-cell">{isInvoice ? t.documents.dueDate : t.documents.validUntil}</Th>
          <Th>{t.common.status}</Th>
          <Th className="text-right">{t.documents.total}</Th>
          {isInvoice && <Th className="hidden lg:table-cell text-right">{t.documents.balance}</Th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((d) => (
          <tr key={d.id} className="hover:bg-slate-50">
            <Td>
              <Link href={`/${d.kind === "invoice" ? "invoices" : "quotations"}/${d.id}`} className="whitespace-nowrap font-medium text-slate-900 hover:text-brand-700">
                {d.number}
              </Link>
              {showCustomer && <span className="block max-w-[10rem] truncate text-xs text-slate-500 sm:hidden">{d.customerName}</span>}
            </Td>
            {showCustomer && (
              <Td className="hidden sm:table-cell">
                <span className="block max-w-[14rem] truncate">{d.customerName}</span>
                {d.customerCompany && <span className="block max-w-[14rem] truncate text-xs text-slate-500">{d.customerCompany}</span>}
              </Td>
            )}
            <Td className="hidden whitespace-nowrap sm:table-cell">{fmt.date(d.issueDate)}</Td>
            <Td className="hidden whitespace-nowrap md:table-cell">{fmt.date(d.dueDate)}</Td>
            <Td>
              <StatusBadge status={d.displayStatus} label={t.status[d.displayStatus]} />
            </Td>
            <Td className="tabular whitespace-nowrap text-right font-medium">{fmt.money(d.total, d.currency)}</Td>
            {isInvoice && (
              <Td className="tabular hidden whitespace-nowrap text-right lg:table-cell">
                {d.status === "cancelled" || d.balance === 0 ? "—" : fmt.money(d.balance, d.currency)}
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
