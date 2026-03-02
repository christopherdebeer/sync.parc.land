/-
  Σ-Calculus: Reduction Rules
-/
import SigmaCalculus.Term

namespace SigmaCalculus

structure Emission where
  scope : String
  output : Out
  deriving Repr

/-- Single-step reduction. -/
inductive Step : Substrate → Term → Substrate → Term → List Emission → Prop where
  | activate_write :
      φ σ = true →
      allInScope s (W σ) = true →
      Step σ (Term.write φ s W) (σ.applyWrites (W σ)) Term.empty []
  | observe_emit :
      φ σ = true →
      Step σ (Term.observe φ s R) σ (Term.observe φ s R) [⟨s, R σ⟩]
  | par_left :
      Step σ e₁ σ' e₁' em →
      Step σ (e₁ ∥ e₂) σ' (e₁' ∥ e₂) em
  | par_right :
      Step σ e₂ σ' e₂' em →
      Step σ (e₁ ∥ e₂) σ' (e₁ ∥ e₂') em
  | scope_step :
      Step σ e σ' e' em →
      Step σ (Term.scope s e) σ' (Term.scope s e') em

/-- Multi-step (reflexive transitive closure). -/
inductive Steps : Substrate → Term → Substrate → Term → Prop where
  | refl : Steps σ e σ e
  | step : Step σ e σ' e' em → Steps σ' e' σ'' e'' → Steps σ e σ'' e''

def Stuck (σ : Substrate) (e : Term) : Prop :=
  ∀ σ' e' em, ¬ Step σ e σ' e' em

def Reachable (σ₀ : Substrate) (e : Term) (σ : Substrate) : Prop :=
  ∃ e', Steps σ₀ e σ e'

def Confluent (σ₀ : Substrate) (e : Term) : Prop :=
  ∀ σ₁ σ₂ e₁ e₂,
    Steps σ₀ e σ₁ e₁ → Stuck σ₁ e₁ →
    Steps σ₀ e σ₂ e₂ → Stuck σ₂ e₂ →
    σ₁ = σ₂

end SigmaCalculus
