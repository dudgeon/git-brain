# AI Scribe Perspective & Education

---
title: AI Scribe Perspective & Education
type: research
status: exploratory
position: 1st-author (likely)
journal: TBD — AEM or Annals of Emergency Medicine preferred; NEJM Catalyst, JAMA Viewpoint also considered
theme: ai-clinical-innovation
permalink: research/ai-scribe-perspective
---

## Overview

Perspective/commentary piece arguing that the dominant fear narrative around ambient AI scribes — that they erode clinical reasoning — fundamentally misunderstands what physicians currently do when they document. The core reframe: modern medical documentation is a medico-legal/billing compliance exercise, not a clinical reasoning exercise. Ambient scribes don't offload critical thinking; they offload the secretarial distraction *from* critical thinking.

This piece is **not a rebuttal** of O'Rourke/Abernethy et al. (2026) JGIM. Rather, it takes a complementary and more technically nuanced view, extending their guardrails argument by describing the LLM technical underpinnings that make section-specific inference risk concrete and actionable.

**Working title candidates:**
- "The Note Is Not the Thinking: Decoupling Documentation from Clinical Reasoning in the Age of Ambient AI"
- "Unshackling the Clinician: How Ambient AI Scribes Could Restore Critical Thinking to Emergency Medicine"
- "Transcription Is Not Reasoning: A Modular Framework for Ambient AI Scribes in Medical Education"

**Estimated length:** 2,000–3,000 words (perspective/commentary format)

**Discovery document:** Created Feb 18, 2026 from mid-year review conversation with Dr. Robert Cloutier.

---

## Refined Framing (Feb 19, 2026)

### Argumentative Arc
1. **Faculty data as grounding:** OHSU Abridge faculty implementation data (faculty-only rollout to date) demonstrates where ambient scribes work well — efficiency, burnout reduction, presence with patients. This is the "this works, here's why" foundation.
2. **The pivot:** Medical education is categorically different from faculty practice, and the technical reasons why matter.
3. **The technical LLM section:** One focused, accessible section explaining temperature and sampling parameters (top-p, top-k) in the context of differential diagnosis generation — without getting lost in the weeds.
4. **The core technical insight:** 
   - High temperature → creative, broad output (appropriate for HPI narrative generation)
   - High temperature applied to A&P/MDM → statistically likely differentials rather than contextually appropriate ones
   - Low temperature → coherent, confident note, but potentially a prematurely closed differential
   - Neither setting is "right" for MDM, and no ambient scribe vendor is currently transparent about what parameters they use or whether they differentiate by note section
5. **The actionable critique:** Demand section-level transparency from vendors. Advocate for inference-mode disclosure. Push for trainee-specific configurations *before* rollout — not after.

### Positionality as Asset
Steve is writing from a unique position: real faculty implementation data in hand, four months away from trainee rollout at OHSU, and actively designing guardrails. This is not armchair speculation — it's a practitioner-informaticist with skin in the game. This should be made explicit in the piece.

### Faculty Data Strategy
OHSU Abridge data is faculty-only. This limitation is reframed as a feature:
- Faculty data provides the empirical grounding ("ambient scribes demonstrably improve efficiency and presence")
- The absence of trainee data makes the argument *more* urgent, not weaker
- The four-month rollout timeline creates genuine stakes: we are writing the guardrails now, before the data exists

### Journal Fit
- **AEM or Annals of Emergency Medicine** — preferred. Right readership (ED physicians, educators), sufficient word count for technical section and faculty/trainee contrast.
- **NEJM Catalyst** — good for health systems angle, but may not want LLM technical depth.
- **JAMA Viewpoint** — high impact but tight word count; difficult to make full argument.

---

## Core Argument

The note is not the thinking. Documentation-as-compliance has been conflated with documentation-as-reasoning for decades, and ambient scribes expose that conflation. The question should not be "what do we lose?" but "what do we gain, and how do we use it wisely?" — and critically, how do we demand that vendors build tools that reflect this distinction.

---

## Key References

### Must-Read/Cite
- **Abernethy & O'Rourke et al. (2026) JGIM** — "Integrating AI Scribes into Medical Education: Guardrails for Preserving Clinical Reasoning" — primary paper to build on; Dr. Jane Abernethy MD, MBE is corresponding author; contacted Feb 19 re: potential collaboration
- NEJM Catalyst (2025) — Kaiser Permanente 2.5M encounter study
- Shah et al. (2025) JAMIA — Stanford pilot (burnout/task load reduction)
- Hill et al. (2013) Am J Emerg Med — 4,000 clicks study
- Pinevich et al. (2021) PMC 8387128 — systematic review of EHR time

### Supporting
- PMC 7043175 — EMR "good, bad, ugly" (Thoreau quote, Relman, air traffic controller analogy)
- PMC 10114050 — documentation burden in EDs
- PMC 7132445 — "From Hippocrates to HIPAA"
- PMC 9599146 — "Medical Records: A Historical Narrative"

---

## Collaborators / Outreach

- **Rob Cloutier** — potential co-author; T-chart era historical perspective; source of original discovery conversation
- **Jane Abernethy MD, MBE** — corresponding author of O'Rourke et al. (2026) JGIM; contacted Feb 19 re: complementary paper and potential co-authorship
- **Penn Medicine CRISP team** — potential collaboration on education angle

---

## Open Questions

1. Does Abernethy respond positively to collaboration? If so, co-authorship significantly strengthens the piece and the relationship.
2. Does Rob Cloutier want to be a co-author?
3. Can OHSU Abridge faculty data be extracted and used? What IRB considerations apply?
4. Standalone piece or connected to Nuts & Bolts AI literacy paper?
5. Conference presentation first (e.g., SAEM)?
6. How does this intersect with Jordan Wackett's AI scribe survey work?

---

## Activity Log

- **2026-02-18** — Discovery document created from mid-year review conversation with Cloutier
- **2026-02-19** — Added to research portfolio as exploratory project. Framing refined: complementary to Abernethy/O'Rourke rather than rebuttal; OHSU faculty data as empirical grounding; LLM inference/temperature as novel technical contribution; four-month trainee rollout as stakes. Outreach email drafted to Dr. Jane Abernethy re: collaboration. One-month horizon to sharpen focus (~March 19 check-in).

---

## Action Items

- [ ] Send outreach email to Dr. Jane Abernethy MD, MBE (drafted Feb 19)
- [ ] Read O'Rourke/Abernethy et al. (2026) JGIM in full
- [ ] Assess OHSU Abridge faculty data — what's extractable, what IRB implications exist
- [ ] Decide on journal target (leaning AEM or Annals)
- [ ] Draft lawyer/court reporter analogy opening
- [ ] Draft LLM technical section (temperature/top-p in context of MDM generation)
- [ ] Discuss co-authorship with Rob Cloutier
- [ ] Research vendor transparency on inference parameters — are any ambient scribe companies disclosing this?
- [ ] Investigate whether any tools differentiate transcription mode vs. inference mode by note section
- [ ] One-month check-in (~March 19): assess focus, Abernethy response, decide whether to proceed
