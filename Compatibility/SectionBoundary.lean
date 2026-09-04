import LemmaScript

/- This checks the structural assumption made by the gatherer: a Velvet
   obligation created inside an anonymous section is available afterward. -/
section

set_option loom.semantics.termination "total"
set_option loom.semantics.choice "demonic"

method sectionBoundary (x : Int) return (result : Int)
  ensures result = x
  do
    return x

end

section

set_option loom.semantics.termination "total"
set_option loom.semantics.choice "demonic"

prove_correct sectionBoundary by
  loom_solve

end
