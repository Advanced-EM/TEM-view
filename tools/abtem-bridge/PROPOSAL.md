# Proposal for the abTEM team (draft, for Roberto to adapt)

**What exists.** TEM-view is a browser digital twin of a TEM/STEM. It has a physical console, voice and AI-agent
control, and Python scripting. A prototype bridge sends the microscope's current state to abTEM and shows abTEM's
result next to the live, approximate one. It covers:
- TEM, STEM, 4D-STEM, SAED and CBED;
- gold particles on carbon, Si/SiO₂, a SrTiO₃ grain boundary and graphene.

The bridge passes the state in abTEM's conventions:
- polar aberration coefficients;
- the focal spread as a 1/e width;
- detector angles;
- frozen phonons from the holder temperature;
- the specimen rebuilt in 3D from the same recipe.

On graphene at 80 kV the two images correlate at 0.94 with no offset.

**What it would give abTEM:**
- A front end that looks and feels like a microscope for students and new users, with abTEM as the
  "certified" reference behind each acquisition. Every result carries abTEM's version, settings and citation.
- A standard request format (`temview-abtem/1`, plain JSON) that other front ends could use too: instrument
  vendors' simulators, AI agents (TEM-view's MCP server), teaching labs.
- Validation data both ways: where the fast model and abTEM disagree, which is useful for teaching approximations.

**Questions for the abTEM team:**
1. Would you review the mapping of conventions (`README.md`, "Conventions")? In particular:
   - the angular-spread equivalence;
   - beam tilt standing in for small specimen tilts;
   - frozen-phonon amplitudes;
   - sampling and preset choices.
2. Where should the bridge live: in abTEM (for example as `abtem.bridges.temview`), or here under GPL-3.0?
3. Is there interest in a hosted endpoint (GPU) for classes and the exhibit, with appropriate credit and limits?
4. Should the specimen recipes come from shared structure files (CIF and ASE trajectories), so that both codes and
   the MOF and protein specimens use the same atoms?
5. How would you like abTEM credited in the exhibit (wording, logo, link)?
