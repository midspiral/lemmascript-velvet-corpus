import LemmaScript

/- This checks the structural assumption made by the gatherer: a Velvet
   obligation created inside an anonymous section is available afterward. -/
section

set_option velvet.semantics.termination "total"

method sectionBoundary (x : Int) returns (result : Int)
  ensures result = x
  do
    return x

end

section

set_option velvet.semantics.termination "total"

prove_correct sectionBoundary by
  velvet_vcgen [sectionBoundary] with finish

end
