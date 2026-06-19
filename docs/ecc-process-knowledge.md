# ECC Process Knowledge

This tracker models Engineering Change Council (ECC) work for Change Requests
(CRs). It is a workflow guide for the assistant and the UI.

## Core Flow

1. Intake: IPT submits an ECC meeting request with CR number, engine program,
   component/model, requested review, classification guess, date/time, and
   charge number.
2. Booking: coordinator verifies the charge number is active, creates or links
   the CR folder, reserves the meeting slot, updates the agenda tracker, and
   sends the documentation notification.
3. Documentation: IPT uploads required documents before the deadline, typically
   noon two days before the meeting. If required documents are missing by the
   deadline, the meeting can be cancelled and the IPT must submit a new request.
4. Pre-meeting review: coordinator checks the package for completeness and may
   review with the IPT before the meeting.
5. Meeting: IPT presents the package, quorum reviews checklist/deck material,
   classification/gate decisions are confirmed, actions are recorded, and
   approvals or out-of-conference approval needs are captured.
6. Post meeting: coordinator saves required PDFs, combines packages where
   applicable, uploads to the NCDOC, updates xClass fields, and records
   disposition in the tracker.
7. CM Working List: when a CR is ready for Configuration Management (CM),
   Engineering Services screens readiness, gathers the CM list data, and sends
   ready CR rows to CM through the weekly CM Working List process.
8. Actions/OOC approvals: open actions require evidence before closure. Open
   actions usually block the next meeting and OOC approvals unless the chair or
   action wording explicitly says they do not hold up progression.
9. Closure: all actions are closed, all approvals are documented, final ECC
   chair approval is obtained, final PDFs are uploaded/classified, and closure
   notification is sent.

## ECC Boards

- PWES Commercial: supports Class Concurrence, Class I, and Class II.
- PWES Military: supports Class Concurrence, Class I, Class II, and Military
  Supplier EC reviews.
- EC&A: supports Class Concurrence, Class I, and Class II.
- P&C: supports Class II only; no formal Class Concurrence and no Class I path.

## Classification and Gates

- Class Concurrence confirms whether the CR is Class I or Class II. P&C changes
  are exempt from formal Class Concurrence.
- PWES Class I is a gated process with CC and Gates 1-4.
- EC&A Class I is a gated process with CC and Gates 1-3.
- Class II is a single review path, commonly represented as CII after CC.
- Military Supplier EC is a PWES Military review for Pratt & Whitney Supplier
  Class II Military ECs before submission to Pratt & Whitney. It can be paired
  with Class Concurrence and Class II in the same session, but the Military
  Supplier EC review should occur first.
- Delta Reviews occur when the original disposition is held for actions or
  rejected and actions must be substantiated before approval.
- Waivers can bypass an in-person review, waive a gate/review, or waive ECC for
  admin/non-technical changes. Waivers still require approval evidence, PDFs,
  NCDOC upload, xClass handling, and notification.

## Military Supplier EC Process

Source procedure: EC-25230 Military Supplier EC Processes, effective
2025-03-31. Scope is review of Pratt & Whitney Supplier Class II Military ECs
before submission to Pratt & Whitney. COTS for military applications such as
F117 and F139/PW4062 Tanker are not applicable to this process.

Scenario selection:

- Scenario 1: Hamilton Sundstrand CR = yes, PW 51XXXXX drawing affected = yes,
  other PW drawing affected = no. A supplier EC drives an HS CR and a PW EC
  because the parts are co-owned by HS and PW.
- Scenario 2: Hamilton Sundstrand CR = yes, PW 51XXXXX drawing affected = no,
  other PW drawing affected = yes. The HS CR drives a PW Class II EC.
- Scenario 3: Hamilton Sundstrand CR = yes, PW 51XXXXX drawing affected = no,
  other PW drawing affected = no. The HS CR requires PW customer approval but
  does not drive a PW Class II EC.
- Scenario 4: Hamilton Sundstrand CR = no, PW 51XXXXX drawing affected = no,
  other PW drawing affected = yes. The supplier EC drives a PW Class II EC.
- Scenario 5: Hamilton Sundstrand CR = no, PW 51XXXXX drawing affected = no,
  other PW drawing affected = no. The supplier EC does not drive a PW Class II
  EC.

Common Military Supplier EC workflow:

- IPT submits an ECC Meeting Request per EC-20120 on SharePoint with Review
  Being Requested set to `Military Supplier EC`.
- If the IPT is ready for all review types, it can also request Class
  Concurrence and Class II. In that case, the Supplier ECC review is held before
  Class Concurrence and Class II during the same session. Otherwise, Class
  Concurrence and Class II can be requested for a later date.
- Class Concurrence and Class II are recommended not to be approved by the ECC
  Chair until Military Supplier ECC is complete.
- ECC Coordinator provides the IPT with the network folder for ECC documents.
- IPT completes Military Supplier ECC Checklist EC-60019 before the Military
  Supplier ECC review and saves it in the ECC folder.
- ECC Coordinator reviews EC-60019 and supporting documents for completeness
  and sends feedback to the IPT.

PD L3/redline prerequisites for Scenarios 1, 2, and 4:

- Before the ECC folder step, the IPT submits redlines and EC-60020 to
  Engineering Services for Product Definition Level 3 review.
- Scenario 1 uses applicable HS drawing redlines; PD L3 also reviews the
  redline package per EC-60008 for the 51XXXXX Series Checklist.
- Scenarios 2 and 4 use applicable PW drawing redlines.
- PD L3 approval is used for REA Kit Approval and is a prerequisite for the MS
  ECC package. The PD L3 should copy the ECC DL and EPO DL on the approval
  email.
- Redlines are stored in PW TCE ETFF > Eng Requirements and Layout > Design
  Layout.
- Engineering Services Product Definition is a required approver for Military
  Supplier ECC. Prefer naming the same PD L3 who approved the redlines.
- If review actions change redlines, the PD L3 must review the revised redlines
  and send a new approval email.
- If ECC approvals are gathered out of conference, the workflow can exclude the
  PD L3 because the PD L3 email approval is the evidence.

Military Supplier EC package guidance:

- Common package items include EC-60019, filled-out HSF-5280.03, filled-out
  12028 form, supplier EC evidence, supplier redlines where applicable, SADVP if
  applicable, and deviation if applicable.
- Scenario 1 adds Supplier EC, Supplier Redlines, and Hamilton Sundstrand
  redlines.
- Scenario 2 uses Supplier EC/CR Report and Supplier/Hamilton Sundstrand
  redlines.
- Scenario 3 uses Supplier EC/Hamilton Sundstrand CR and Supplier/Hamilton
  Sundstrand redlines.
- Scenarios 4 and 5 use Supplier EC and Supplier Redlines.

Military Supplier EC action and closeout rules:

- If actions are assigned, action closure confirmation from the action
  requestor is required for each action by email.
- If quorum requests a delta ECC review, action closure confirmations are
  required before the delta review.
- Military Supplier ECC closeout uses a separate NCDOC from the ECC Class
  Concurrence/Class II NCDOC and from the Supplier EC NCDOC.
- Set up the MS ECC NCDOC per EC-30001. Use
  `PWES Military Supplier ECC Checklist (EC #)` for supplier EC-numbered cases
  and `PWES Military Supplier ECC Checklist (CR-#)` for HS CR-numbered cases.
- For an MS ECC review meeting, required closeout files are the post-meeting PDF
  of the checklist, OOC approvals, and final checklist if applicable.
- For a waiver path, required closeout files are ECC Waiver Request Form
  EC-60002, waiver approvals, the final checklist, and required OOC approvals.
- Scenario 3 specifically uploads the PDF of EC-60019 to its own NCDOC rather
  than the normal ECC NCDOC.
- When a PW EC validates in Scenarios 1, 2, or 4, the Class II EC Writer
  approves the Supplier EC NCDOC. In Scenario 2, the PW EC Coordinator/Class II
  Council Chair also informs Hamilton Sundstrand CM and the PW Supplier EC
  Coordinator that the validated PW EC constitutes customer approval of the HS
  CR.

Military Supplier EC terms:

- MS ECC: Military Supplier Engineering Change Council.
- HS: Hamilton Sundstrand.
- COTS: commercial off-the-shelf.
- PD L3: Product Definition Level 3.
- REA: request for engineering action.
- CL II: Class II.
- DL: distribution list.
- HSF-5280.03: form saved with the MS ECC package.
- ETFF: Engineering Task File Folder in PW TCE.
- PW TCE: Pratt & Whitney Teamcenter Enterprise; prefer this term over PW TC.

## CM Working List Process

Source procedure: EC-35200 CM Working List Submission Expanded Work
Instructions, Rev A, effective 2024-09-01. Scope is ECC Coordinator and ECC
Chair guidance for reviewing CR readiness for Configuration Management and
submitting ready CRs to CM. Rockford CRs do not use this process because the
Rockford CM group has its own process.

CM Working List purpose and timing:

- CM asked Engineering Services to screen CRs before they go to CM.
- Engineering Services provides CM a weekly list of CRs ready for CM to work.
- ECC review must be held before a CR is sent to CM, but ECC closeout does not
  have to be complete before CM is authorized to work the CR. Tell the IPT there
  is a small risk that an ECC approver may later request a change if the CR goes
  to CM before ECC is complete.
- For an ECC waiver, start the CM Working List discussion as soon as the waiver
  path is known because waiver paths often have short lead time before the CR
  must go to CM.

CM Working List IPT follow-up:

- During or after the ECC meeting, tell the IPT that Engineering Services
  screens CRs for CM and sends CM a weekly list of ready CRs.
- For Commercial and Military ECC trackers, select the CR row and use the `CM Working List Follow-Up Email` button to draft the IPT email. Add the IPT email address and send it. For EC&A, compose a comparable email using the SharePoint tracker information.
- If the IPT is new to the process, a short meeting can be more efficient than
  handling the questions by email.
- Ask for the Change Order completion date, or confirm the date if it is already
  on the template/checklist.
- Ask for program risk, meaning the risk to the program if the CR is not
  completed by the Change Order completion date.
- Share the priority code breakdown from the `Priority Codes` tab of the CM
  Working List Tracker and ask the IPT for the CR priority code.
- Ask whether the IPT wants the CR to go to CM before ECC is closed out, and
  explain the change-request risk noted above.
- Ask whether the supporting documents are uploaded to the Supporting Documents
  NCDOC for the CR in PLM. If not, ask when the IPT expects to upload them.

CM Working List tracker handling:

- Record the CM list information in the appropriate location: `Commercial Weekly Output`, `Military Weekly Output`, or the EC&A SharePoint tracker.
- Use the `Template` tab to fill in the other columns for the CR.
- Once supporting documents are uploaded, review the CR documents for accuracy,
  completeness, and the applicable supporting-document requirements. BCC CM on
  emails sent to the IPT with feedback.
- Use the Collins PLM/Change Notes/Status column for notes such as missing
  documents, the next IPT follow-up date, `CS QUEUE`, or `CM QUEUE`.
- When the required documents and participants are satisfactory, request that
  the IPT submit the CR to workflow.
- If someone from Project rather than CM is chosen as the PLM Change Specialist,
  the Change Specialist must approve in PLM before CM works the CR. The Release
  Status changes from `In Work` to `In Review` after Change Specialist approval.
  Use `CS QUEUE` when the Release Status is `In Work`, and `CM QUEUE` when the
  Release Status is `In Review`. The CR may still be sent to CM before Change
  Specialist approval if approval is requested in parallel.
- If 51XXXXX drawings are affected, request Engineering Services Product
  Definition review of the Collins Marked Prints against the Pratt & Whitney
  redlines to confirm the design intent matches.

CM weekly submission:

- Every Friday, an ECC coordinator or chair sends the CM Working List email to
  `CMWorkingListWLOX@collins.com`, also shown as GP Collins WLOX CM Working List
  - Power & Controls. The email can include Commercial, Military, and EC&A items
  together when needed.
- Send the email only after all required documents, based on 107-WLX-003, have
  been uploaded under supporting documents in PLM and the ECC Chair or
  Coordinator has reviewed them for accuracy and completeness.
- Copy and paste the rows directly from the tracker/template into the email. Do
  not paste the list as a photo because CM needs readable text.
- After CM responds that the CR was added to the working list, the CR can be
  unfiltered from the CM Working List Tracker and the tracker task can be marked
  complete.

## Required Package Guidance

- PWES Commercial/Military Class Concurrence: checklist, slide deck, WU report,
  and MP redlines when applicable.
- PWES Class I: checklist, Class I slide deck, WU report, MP redlines, and
  electronic addendum if EEC or related details are affected.
- PWES Class II: checklist, Class II slide deck, WU report, MP redlines, and
  electronic addendum if applicable.
- EC&A Class Concurrence: EC&A slide deck, WU report, and MP redlines.
- EC&A Class I: Gate 1/2/3 templates, WU report, and MP redlines.
- EC&A Class II: Class II slide deck, WU report, and MP redlines.
- P&C Class II: checklist, SUB form, WU report, MP redlines, and electronic
  addendum if applicable.
- PWES Military Supplier EC: Military Supplier ECC Checklist EC-60019,
  HSF-5280.03, filled-out 12028 form, supplier EC evidence, supplier redlines
  where applicable, SADVP if applicable, deviation if applicable, and PD L3
  redline approval evidence for Scenarios 1, 2, and 4.

## Dispositions

Use one of the standard dispositions when it fits:

- Approved
- Approved w/Actions
- Held for Actions
- Pending OOC Approvals

If none applies, use a concise descriptive disposition.

## Closure Rules

- A CR is not closed until all actions are closed and supported by evidence.
- A CR is not closed until all required OOC approvals and chair approval are
  gathered and documented.
- Approval evidence must identify approver, CR number, role, what was approved,
  source, and timestamp/date where available.
- NCDOC and xClass work should remain visible as separate checklist states.
- CM Working List is a records/CM readiness state, not closure. A CR can be on
  the CM Working List before ECC closeout is complete if the IPT accepts the
  risk and the required CM readiness checks are complete.
- For MS ECC, "pushed to closure" means the CR is in NCDOC/xClass records work,
  not the Closure phase and not Closed, until NCDOC, xClass, and IPT notification
  are complete.
- Design authority affects the closure path and notification routing.

## Naming Rules to Support

- Folder: `CR-# - Engine Program - Component Model`
- Calendar title: `CR-# - Engine Program - Engine Component`
- Checklist: `CR-# - Review/Gate - Date`
- PowerPoint: `CR-# - Review/Gate Review - Date`
- Combined PDF: `CR-# - Combined - Reviews/Gates - Date`
- Attendance: `CR-# - Attendance - Review/Gate - Date`
- OOC approval: `CR-# - OOC Approval - Role - Last Name - Date`
- OOC approval PDF: `CR-# - OOC Approvals - Reviews/Gates - Date`
- NCDOC IDs: `PWES-ECC.CR-#`, `ECA-ECC.CR-#`, or `PC-ECC.CR-#`
- Military Supplier EC NCDOC title: `PWES Military Supplier ECC Checklist (EC #)`
  or `PWES Military Supplier ECC Checklist (CR-#)`, separate from the Class
  Concurrence/Class II NCDOC and separate from the Supplier EC NCDOC.
- CM Working List email recipient: `CMWorkingListWLOX@collins.com`; copy rows
  directly from the tracker/template instead of using a screenshot or photo.
