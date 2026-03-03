/-
  Σ-Calculus: Terms — the five forms.
-/
import SigmaCalculus.Basic

namespace SigmaCalculus

inductive Out where
  | text : String → Out
  | data : List (String × Val) → Out
  | silent : Out
  deriving Repr

abbrev WriteFn := Substrate → List (Loc × Val)
abbrev ReadFn := Substrate → Out

/-- The five term forms of the Σ-calculus. -/
inductive Term where
  | fact (s : String) (k : String) (v : Val) : Term
  | write (guard : Pred) (s : String) (W : WriteFn) : Term
  | observe (guard : Pred) (s : String) (R : ReadFn) : Term
  | par (e₁ e₂ : Term) : Term
  | scope (s : String) (e : Term) : Term
  | empty : Term

notation:60 e₁ " ∥ " e₂ => Term.par e₁ e₂

def allInScope (s : String) (writes : List (Loc × Val)) : Bool :=
  writes.all fun ⟨l, _⟩ => l.scope == s

/-- A write is additive: only writes to undefined locations. -/
def WriteFnAdditive (W : WriteFn) : Prop :=
  ∀ (σ : Substrate), ∀ p ∈ W σ, σ p.1 = none

/-- All writes in a term are additive. -/
def Term.allAdditive : Term → Prop
  | .write _ _ W => WriteFnAdditive W
  | .par e₁ e₂ => e₁.allAdditive ∧ e₂.allAdditive
  | .scope _ e => e.allAdditive
  | _ => True

/-- A term is observer-only: no writes. -/
def Term.isObserverOnly : Term → Prop
  | .observe _ _ _ => True
  | .par e₁ e₂ => e₁.isObserverOnly ∧ e₂.isObserverOnly
  | .scope _ e => e.isObserverOnly
  | .empty => True
  | _ => False

end SigmaCalculus
