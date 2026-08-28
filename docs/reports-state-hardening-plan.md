# Reports state hardening plan

Target: prevent stale report payloads and normalize loading/error transitions without changing report calculations, APIs, or database behavior.

First candidate: SalesReportsWorkspace, which currently lacks the request-generation guard already used by customer, purchase, inventory, and general report workspaces.
