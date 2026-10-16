# NiegeIP Connect interaction contract

Business sources: `docs/backend-contract.md` defines purchase/export access; `docs/deployment.md` defines OAuth lifetime and official hosting; `README.md` defines user scope. This document maps them to UI behavior, not new legal policy.

| Capability | Canonical owner                     | Source of truth             | Allowed variants      | Verification         |
| ---------- | ----------------------------------- | --------------------------- | --------------------- | -------------------- |
| Form       | src/ui.ts connectPage/browserScript | DESIGN.md, backend contract | login/consent         | test/browser.ts      |
| Scrollbar  | src/ui.ts stylesheet                | DESIGN.md                   | global document       | narrow browser check |
| Feedback   | src/ui.ts status + field-error      | this contract               | pending/success/error | test/browser.ts      |

There are no tables, selects, date pickers or destructive resource actions.

Authorization is initiated by the MCP client. The browser page displays requested permissions, client-supplied name and callback origin. SMS is sent only after clicking “获取验证码”. Client validation focuses the first invalid input; server remains authoritative. The user explicitly consents before “登录并授权”. During I/O, buttons are disabled and status announces progress; errors allow correction/retry. Successful authorization returns to the validated client callback. Cancel returns `access_denied`. Expired or browser-mismatched authorization tells the user to restart from the Agent.

Do not persist phone or OTP in browser local/session storage. Do not warn about unsaved edits on cancellation: abandoning this credential form is deliberate. Failed authorization must never display successful connection. Follow-up download completeness is conveyed by tool output, not inferred here.
