# Bharat Makaan — AI Document & Floor-Plan Extraction Specification

## 1. Supported Document Inputs

- Architectural master & tower plans (`application/pdf`)
- Typical, podium, lower-residential, refuge, and penthouse floor plans (`application/pdf`, `image/png`, `image/jpeg`, `image/webp`)
- Tower unit numbering & area schedules (`application/pdf`)
- Individual apartment, villa, plot, and commercial office layouts (`application/pdf`, `image/*`)
- Project brochures (`application/pdf`)

All uploads enforce:
- Maximum file size: **25 MB**
- Strict MIME allowlist (`application/pdf`, `image/png`, `image/jpeg`, `image/webp`)
- Tenant-isolated Firebase Storage path: `organizations/{orgId}/projects/{projectId}/ai-uploads/...`
- Untrusted-content prompt-injection sanitization (document text is isolated inside non-executable `<UNTRUSTED_DOCUMENT_DATA>` envelopes and stripped of instruction-override patterns).

---

## 2. Multi-Stage Extraction Pipeline

1. **Storage & Structural Inspection**:
   - Verifies file existence, size, MIME header, and PDF structural integrity via `pdf-lib` (`PDFDocument.load`), rejecting corrupt or malformed files cleanly.
   - Enumerates exact page count, page dimensions, document metadata, and extractable PDF text streams per page.
2. **Vision & Structured Output Analysis**:
   - Invokes `OPENAI_MODEL_VISION_FLOORPLAN` (`gpt-6.1-terra`) via OpenAI Responses API with strict JSON Schema Structured Outputs.
   - Escalates multi-page schedules or low-confidence/ambiguous pages to `OPENAI_MODEL_ESCALATION` (`gpt-6-astra`).
3. **Anti-Hallucination & Provenance Enforcement**:
   - Every extracted field records:
     - `sourceDocumentId` & `sourceFileName`
     - `sourcePage` (1-indexed page number)
     - `sourceRegion` (e.g., `TITLE_BLOCK`, `UNIT_SCHEDULE_TABLE`, `FLOOR_KEY_PLAN`)
     - `extractionStatus` (`EXTRACTED` | `AMBIGUOUS` | `MISSING` | `USER_CORRECTED`)
     - `confidence` (`0.0`–`1.0`)
     - `reviewStatus` (`PENDING_REVIEW` | `VERIFIED` | `CORRECTED` | `SKIPPED`)
   - **Strict Non-Extrapolation Rule**:
     - If a floor plan is labeled `"Typical Floor"` without explicit floor numbers on the sheet or in session answers, `applicableFloors` is NEVER guessed—the engine flags `applicableFloors` as `MISSING` and prompts the user to confirm the exact floor range before preview generation completes.
     - Floor counts, unit counts, saleable/carpet areas, facings, and physical parking slots are never fabricated when absent from the source.
   - **Zero Price Fabrication Rule**:
     - Document extraction never invents unit prices; imported units inherit pricing strictly through the project's approved `PriceBook` and 6-level pricing engine.

---

## 3. Split-Screen Review & Chunked Import

- **Left Pane**: Original PDF/image page viewer with page selector and provenance indicators.
- **Middle Pane**: Extracted Tower → Floor → Unit hierarchy tree + inline editable table allowing staff to rename units, correct BHK/areas/facings, merge/reassign floor templates, or skip specific units.
- **Right Pane**: AI Assistant Q&A for missing fields, live Change Summary (`Towers to create`, `Floors to create`, `Units to create`, `Units to update`, `Duplicate records`, `Documents to link`, `Conflicts`), and role-gated **Approve & Import** / **Cancel** actions.
