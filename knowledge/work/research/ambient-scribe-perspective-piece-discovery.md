# Perspective Piece: Post-Ambient Scribe Paradigm — Discovery Document

**Status:** Discovery/Pre-writing (v2 — modularity + LLM inference arguments added)
**Origin:** Mid-year review with Dr. Robert Cloutier, 2026-02-18
**Full document:** Available as downloadable file from Claude chat (v2)

## Core Thesis (Refined)
The "AI scribe" debate is flattened and unproductive because it treats a modular tool as monolithic. The note itself is modular — HPI, ROS, PE, Results, MDM/A&P — and each section carries fundamentally different cognitive stakes. Transcription is secretarial. MDM generation is clinical reasoning. The question isn't "should we use AI scribes?" but "which note sections should AI generate, which should the physician compose, and in what order?"

## Key Arguments
1. **The Lawyer Analogy:** No one expects lawyers to transcribe their own trials
2. **Historical Arc:** T-charts → EMR → Ambient scribe, each optimizing for different things
3. **Cognitive Science:** Real-time documentation compensates for working memory limits, not reasoning
4. **NEW — The Modularity Problem:** "AI scribe" collapses transcription, organization, and inference into one label. Risk is section-specific, not tool-specific.
5. **NEW — Documentation ≠ Reasoning:** We conflated the process (bedside reasoning, attending-resident discussion) with the artifact (the note). The note is the receipt, not the thinking.
6. **NEW — LLM Inference Risk:** When AI *generates* MDM/A&P rather than transcribing it, LLMs predict highest-probability diagnoses, systematically suppressing rare-but-dangerous differentials. Temperature/top-p/top-k settings become patient safety parameters.
7. **Privacy Paradox:** Medicine self-documents due to privacy culture; AI may resolve this better than human scribes
8. **Education Opportunity:** Freed cognitive space → bedside teaching, clinical reasoning conversations

## The Modular Framework (New)
| Note Section | AI Function | Cognitive Stake | Risk |
|---|---|---|---|
| HPI/ROS | Transcription | Secretarial | Low |
| PE/Results | Organization | Formatting | Low-Moderate |
| MDM/A&P | Inference/Generation | Clinical reasoning | **High** |

**Proposed policy:** AI transcribes → physician reasons → AI formats. Don't throw baby out with bathwater.

## LLM Diagnostic Narrowing Risk (New)
- Low temperature = confident, narrow, conventional assessments
- Highest-probability ≠ safest differential
- End users can't see model parameters — black box problem
- Vendors must be transparent about inference vs. transcription by section
- Temperature/sampling settings should be evaluated as patient safety parameters

## Key Evidence Points
- ED physicians: 44% of time on data entry, 4,000 clicks/shift
- Only 12-13% of intern time on direct patient contact
- Kaiser: 15,700+ hours saved across 2.5M encounters
- 1995/1997 E/M guidelines explicitly rewarded documentation volume over quality

## Critical References
- O'Rourke et al. (2026) JGIM — "Integrating AI Scribes into Medical Education: Guardrails for Preserving Clinical Reasoning"
- NEJM Catalyst (2025) — Kaiser 2.5M encounter study
- Penn Medicine CRISP initiative — ambient AI for reasoning education

## New Research Gaps Identified
- No section-specific analysis of scribe impact (transcription vs. generation)
- No transparency research on LLM parameters in clinical documentation
- No studies comparing diagnostic breadth in AI-generated vs. physician-generated A&P
- No hybrid model evaluation (AI transcribes, physician reasons first)

## Action Items
- [ ] Decide target journal
- [ ] Discuss co-authorship with Rob Cloutier
- [ ] Pull full-text key references
- [ ] Review O'Rourke et al. in full
- [ ] Research vendor transparency on LLM inference settings
- [ ] Investigate section-specific ambient scribe configurations
- [ ] Set up Claude Co-work project with v2 discovery doc
- [ ] Explore OHSU Abridge data as supporting evidence
