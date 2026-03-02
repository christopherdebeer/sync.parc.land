/-
  Σ-Calculus: Core Types
-/
namespace SigmaCalculus

inductive Val where
  | str : String → Val
  | num : Int → Val
  | bool : Bool → Val
  | null : Val
  deriving Repr, BEq, DecidableEq

structure Loc where
  scope : String
  key : String
  deriving Repr, BEq, DecidableEq

abbrev Substrate := Loc → Option Val

def Substrate.empty : Substrate := fun _ => none

def Substrate.set (σ : Substrate) (l : Loc) (v : Val) : Substrate :=
  fun l' => if l' == l then some v else σ l'

def Substrate.applyWrites (σ : Substrate) (writes : List (Loc × Val)) : Substrate :=
  writes.foldl (fun acc ⟨l, v⟩ => acc.set l v) σ

/-- Substrate inclusion: σ₁ ⊆ σ₂ means σ₂ extends σ₁. -/
def SubstrateSub (σ₁ σ₂ : Substrate) : Prop :=
  ∀ (l : Loc) (v : Val), σ₁ l = some v → σ₂ l = some v

def Substrate.agreeOutside (σ₁ σ₂ : Substrate) (s : String) : Prop :=
  ∀ (l : Loc), l.scope ≠ s → σ₁ l = σ₂ l

abbrev Pred := Substrate → Bool

/-- Monotone: once true, stays true as substrate grows. -/
def PredMonotone (φ : Pred) : Prop :=
  ∀ (σ₁ σ₂ : Substrate), SubstrateSub σ₁ σ₂ → φ σ₁ = true → φ σ₂ = true

end SigmaCalculus
