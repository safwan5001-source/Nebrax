# Why specialized reports are not forced into Saved Views

Saved Views are appropriate for generic tabular result reports where column visibility, order, sizing, density, and sorting are user preferences. They are not automatically appropriate for every financial presentation.

Journal Entries preserve entry-to-lines grouping and entry-level drill-down semantics. Cash Flow uses a structured financial statement with section subtotals and optional comparison columns. Tax Report is a compact summary. Forcing these into the generic table layer only to gain Saved Views would increase regression risk without a clear user benefit.
