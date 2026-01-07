# Type checking through unification

Francesco Mazzoli<sup>1</sup> and Andreas Abel<sup>2</sup>

1 FP Complete*

$<  f@mazzo.li>$

2 Gothenburg University

<andreas.abel@gu.se>

# Abstract

In this paper we describe how to leverage higher-order unification to type check a dependently typed language with meta-variables. The literature usually presents the unification algorithm as a standalone component, however the need to check definitional equality of terms while type checking gives rise to a tight interplay between type checking and unification. This interplay is a major source of complexity in the type-checking algorithm for existing dependently typed programming languages. We propose an algorithm that encodes a type-checking problem entirely in the form of unification constraints, reducing the complexity of the type-checking code by taking advantage of higher order unification, which is already part of the implementation of many dependently typed languages.

Keywords and phrases Dependent types, type checking, higher order unification, type reconstruction

# 1 Introduction

Theories with dependent types have been successfully exploited to design programming languages and theorem provers, such as Agda [9], Idris [3], or Coq [2]. To make these systems practical, the user is presented with a language much richer than the underlying type theory, which will hopefully be small enough to gain confidence in the correctness of the code that type checks it.

One common way to make a type theory palatable is extending it with meta-variables, standing for yet to be determined terms, and solved by unification. Their usage in traditional programming languages is confined to type inference, and thus traditionally they can stand for types only. In dependently typed languages types can contain terms, and thus meta-variables are usually extended to stand for any term in our language. A typical use case for meta-variables is implicit arguments as introduced by Pollack [11], relieving the user of having to write easily inferrable arguments to functions. For example, in Agda we can write a safe head function which extracts the first element of a list, inferring both the type of the elements and the length of the list:

head:  $\{A:\mathsf{Set}\} \to \{n:\mathsf{Nat}\} \to \mathsf{Vec} A(1 + n)\to A$

head  $(x::xs) = x$

Here,  $\mathsf{Vec}A$  denotes a list of length  $n$  with elements of type  $A$ , and  $\mathsf{Set}$  is the type of types. The expression  $\{A:\mathsf{Set}\} \to \{n:\mathsf{Nat}\} \to \ldots$  binds two implicit arguments. When invoking head, the type checker will insert two meta-variables standing for  $A$  and  $n$  and attempt to solve them by inspecting the Vec argument that follows. Note that  $n$  is a value, while in languages such ML and Haskell only types can be implicit.

The task of integrating meta-variables in a type-checking algorithm for dependent types gives rise to complications. For example, consider the task of type checking

true: if  $\alpha \leqslant 2$  then Bool else Nat,

where  $\alpha$  is a yet to be determined (uninstantiated) meta-variable of type Nat. We want the type of true to be Bool, but reduction is impeded by  $\alpha$ . Thus, we cannot complete type checking until  $\alpha$  is instantiated. $^{1}$  The problem lies in the fact that type checking dependent types involves reducing terms to their normal forms, something that can be affected by meta-variables, like in this case.

To solve issues like the one above, the only viable option—apart from refusing to solve them—is to wait for the meta-variables that are affecting type checking to be instantiated, and then resume. This gives rise to a sort of concurrency that makes reasoning about the type checking algorithm arduous. In this paper, expanding on ideas developed in Agda [9] and Epigram [7], we propose an algorithm that encodes a type-checking problem in a set of unification constraints with a single traversal of the term to be checked. The generated constraints can be solved effectively by the unification procedure already employed by Agda, but our elaboration procedure is considerably simpler and shorter than Agda's type-checking code. This highlights an overlap in functionality between the type checker, which needs to check that types and terms are of a certain shape; and the unifier, which checks the equality of terms. Moreover, our algorithm lets us clearly separate concerns between type checking and unification, making it easier to gain confidence on the elaboration procedure and then experiment with various unification "backends".

In the rest of the paper, we will explain the problem more clearly (Section 2). Then we will introduce a simple type theory (Section 3) that will serve as a vector to explain our algorithm in detail. In Section 4 we will give a specification to the unification procedure. The algorithm itself is presented in Section 5, along with some of its properties. We will then briefly discuss the performance and how the algorithm can be extended to support certain popular language features (Section 6).

We have implemented the presented algorithm in a prototype, tog, which covers a subset of Agda—every tog program is also a valid Agda program.2

# 2 The problem

In this section we will explain the challenges faced when type checking dependent types with meta-variables. An Agda-like syntax will be used throughout the examples, please refer to Appendix A for clarifications.

Coming back to the problem of type checking

true:BoolOrNat  $\alpha$

given unistantiated meta-variable  $\alpha$  and definition

BoolOrNat: Nat  $\rightarrow$  Set

BoolOrNat  $= \lambda x\rightarrow$  if  $x\leqslant 2$  thenBoolelse Nat

there are various tempting ways to approach the problem. The most conservative approach is to stop type checking when faced with blocked terms (terms whose normalization is impeded by some meta-variables). However, this approach is unsatisfactory in many instances. Consider

(true, refl): BoolOrNat  $\alpha \times (\alpha \equiv 0)$

Where  $x \equiv y$  is the type inhabited by proofs that  $x$  is equal to  $y$  (propositional equality), and refl is of type  $t \equiv t$  for any  $t$  (reflexivity). Type checking this pair will involve type checking true: BoolOrNat  $\alpha$  and then refl:  $\alpha \equiv 0$ . If we give up on the first type-checking problem, we will not examine the second, which will give us a solution for  $\alpha$  ( $\alpha := 0$ ). After instantiating  $\alpha$  we can easily go back and successfully type check the first part. In general, we want to attempt to type check as much as possible, and to instantiate as many meta-variables as possible—as long as we do so without loss of generality, like in this case.

Another approach is to assume that blocked type-checking problems will eventually be solved, and continue type checking. However, this road is dangerous since we need to be careful not to generate ill-typed terms or invalid type-checking contexts, as noted by Norell and Coquand [10]. Consider

$$
t e s t: (\alpha \equiv 0) \times (((x: B o o l O r N a t \alpha) \rightarrow B o o l O r N a t (1 + x)) \rightarrow \mathsf {N a t})
$$

$$
t e s t = (\text {r e f l}, \lambda g \rightarrow g \text {t r u e})
$$

Type checking the definition test will involve checking that its type is a valid type, and that its body is well typed. Checking the former will involve making sure that

BoolOrNat  $\alpha =$  Nat

since we know that the type of  $x$  must be  $\mathsf{Nat}$ , given that  $x$  is used as an argument of  $(1+): \mathsf{Nat} \to \mathsf{Nat}$ .<sup>3</sup>

If we assume that the type is valid, we will proceed and type check the body pairwise. Type checking the first element—a proof by reflexivity that  $\alpha$  is equal to 0—will instantiate  $\alpha$  to 0, and then we will be faced with

$$
(\lambda g \rightarrow g \text {t r u e}): ((x: \mathsf {B o o l}) \rightarrow \mathsf {B o o l O r N a t} (1 + x)) \rightarrow \mathsf {N a t}
$$

Note that the type is ill-typed, $^{4}$  violating the usual invariants present when type checking—namely the fact that when we make progress we always generate well-typed terms. Worse, to type check we will instantiate  $x$  with 0, ending up with BoolOrNat (1 + true). With some effort we can exploit this problem to make the type checker loop, and thus type checking will be undecidable.

As mentioned in the introduction, at the heart of the problem lies the fact that to type check we need to reduce terms to their weak head normal form. If reduction is impeded

by meta-variables, we cannot proceed. To overcome this problem, Norell proposed to define type checking as an elaboration procedure: given the problem of type checking  $t$  against  $A$  in context  $\Gamma$ , type checking will produce a term  $u$  that approximates  $t$ :

$$
[   [ \Gamma \vdash t: A ]   ] \rightsquigarrow u
$$

$u$  is an approximation of  $t$  in the sense that it it can be turned into  $t$  by instantiating certain meta-variables—if a subterm of  $t$  cannot be type checked a placeholder meta-variable will be put in its place, an type checking that subterm will be postponed. Type checking will also consist in making sure that, once the postponed type-checking problems can be solved, the placeholder meta-variables will be instantiated accordingly with the corresponding omitted subterm of  $t$  (possibly instantiated further).

For instance, when type checking the type of test, we'll have

$$
\begin{array}{l}\llbracket \vdash ((x: B o o l O r N a t \alpha) \to B o o l O r N a t (1 + x)) \to \mathsf {N a t}: \mathsf {S e t} ] \rightsquigarrow\\\left((x: B o o l O r N a t \alpha) \to B o o l O r N a t \beta\right) \to \mathsf {N a t}\end{array}
$$

Since we cannot type check

$$
x: \text {B o o l O r N a t} \alpha \vdash 1 + x: \text {N a t}
$$

a fresh meta-variable  $\beta$  of type Nat in context  $x: \text{BoolOrNat} \alpha$  replaces  $1 + x$ . Then, when checking the body of test, we will check it against the approximated type generated above. When  $\alpha$  is instantiated, we can resume checking that  $\text{BoolOrNat} \alpha = \text{Nat}$ , and if we are successful, instantiate  $\beta := 1 + x$ . This will prevent us from running into problems when type checking the body, since when we do instantiate  $\alpha$  to 0, we do not have  $1 + x$  later: instead,  $\beta$  is in its place, preserving the well-typedness of the type.

The Agda system, as described in Norell's thesis, currently implements this elaboration interleaving type checking and unification, using some fairly delicate machinery. Our contribution is to describe a type-checking problem entirely in terms of unification constraints, thus simplifying the algorithm. This highlights an overlap in functionality between the type checker, which needs to check that types and terms are of a certain shape, and the unifier, which checks the equality of terms: we are using the unifier as an engine to pattern match on types, with taking meta-variables into account. Moreover, separating the unifier from the type checker makes it easy easy to experiment with different unification "backends" used by the same type checking "frontend".

# 3 The type theory

To illustrate the type-checking algorithm we will make use of a dependent type theory with booleans and one universe. Its syntax is shown in Figure 1.

# 3.1 Terms and types

Terms and types inhabit the same syntactic class. We usually denote terms with  $t$ ,  $u$ , and  $v$ ; and types with  $A$ ,  $B$ , and  $C$ . The theory is designed to be the simplest fragment that presents the problems described in Section 2. For this reason we include a universe Set

```latex
$x,y,z$  -- Variables   
 $\alpha ,\beta ,\gamma$  -- Meta-variables   
-- Types/terms   
 $A,B,C,t,u,v$ $\begin{array}{rl}{\mathrel{\text{:=}}\mathrm{Set}}&{{\mathrel{\text{:=}}}\mathrm{Type~of~types}}\\ {\mid}&{{\mathrel{\text{Bool}}}\mid\mathrm{true}\mid\mathrm{false}}\\ {\mid}&{{\mathrel{\text{:=}}}\mathrm{(}x:A)\to B\mid\lambda x\to t}\\ {\mid}&{{\mathrel{\text{:=}}}\mathrm{n}}\end{array}$  -- Booleans   
-- Dependent functions   
-- Neutral term   
-- Neutral terms   
 $n\quad \coloneqq = h$  -- Head   
 $\mid$  n t -- Function application   
if  $n / x.A$  then  $t$  else  $u$  -- Bool elimination   
 $h\quad \coloneqq = x\mid \alpha$  -- Neutral term heads   
 $\Gamma ,\Delta \coloneqq \cdot \mid \Gamma ,x:A$  -- Contexts   
 $\Sigma ,\Xi \coloneqq \cdot \mid \Sigma ,\alpha :A$  -- Signatures   
 $\theta ,\eta \coloneqq \cdot \mid \theta ,\alpha \coloneqq t$  -- Meta-variable substitutions
```

Figure 1 Syntax

and means of computing with booleans, so that we can write functions from booleans to types—otherwise meta-variables can never prevent us from knowing how a type looks like. The typing rules and algorithms presented in this paper can be extended to a richer theory, as we have done for our implementation, which includes implicit arguments, user defined inductive data types and records, and propositional equality.

# 3.2 Neutral terms, substitutions, and term application

Terms are always kept in  $\beta$ -normal form. Terms headed by a variable or meta-variable are called neutral, the others canonical. Variable and meta-variable substitution immediately restore the  $\beta$ -normal form as soon as the substitution is performed, a technique known as hereditary substitution [13]. Substituting a term  $u$  for a head  $h$ , i.e., a variable  $x$  or meta-variable  $\alpha$ , is written  $t[h := u]$ , reading "substitute  $u$  for  $h$  in  $t$ ". The rules for substitution are not relevant to the paper and are shown in Appendix B. The appendix also defines rules to eliminate redexes that substitution might generate, to restore the  $\beta$ -normal form.

# 3.3 Contexts and signatures

Most operations are done under a context (denoted by  $\Gamma$  or  $\Delta$ ), that stores the types of free variables; and a signature (denoted by  $\Sigma$  or  $\Xi$ ), that stores the type of meta-variables. We tacitly assume that no duplicate names are present in contexts and signatures. We often make use of a global signature  $\Sigma$  throughout the rules, if there is no need for the rules to carry it explicitly since it is never changed. Note that a signature contains only closed types for the meta-variables—we do not make use of an explicit representation of meta-variables in context. This is for the sake of simplicity, since we do not present our unification algorithm in detail, where the contextual representation would be most convenient. Throughout the paper, we will use  $\Gamma \to A$  to indicate the function type formed by all the types in  $\Gamma$  as the

$\overline{\Gamma \vdash \text{Set} : \text{Set}}$ $\overline{\Gamma \vdash \text{Bool} : \text{Set}}$ $\overline{\Gamma \vdash \text{true} : \text{Bool}}$ $\overline{\Gamma \vdash \text{false} : \text{Bool}}$

$\frac{\Gamma \vdash A : \mathsf{Set} \quad \Gamma, x : A \vdash B : \mathsf{Set}}{\Gamma \vdash (x : A) \to B : \mathsf{Set}} \frac{\Gamma, x : A \vdash t : B}{\Gamma \vdash \lambda x \to t : (x : A) \to B} \frac{\Gamma \vdash n \Rightarrow A \quad \Gamma \vdash A \equiv B : \mathsf{Set}}{\Gamma \vdash n : B}$

Figure 2  $\Sigma ;\Gamma \vdash t:A$  Type checking canonical terms

$\frac{x:A\in\Gamma}{\Gamma\vdash x\Rightarrow A}$ $\frac{\alpha:A\in\Sigma}{\Gamma\vdash\alpha\Rightarrow A}$ $\frac{\Gamma\vdash n\Rightarrow(x:A)\to B\quad\Gamma\vdash t:A}{\Gamma\vdash nt\Rightarrow B[x:=t]}$

$\Gamma \vdash n \Rightarrow \text{Bool}$ $\Gamma, x: \text{Bool} \vdash A: \text{Set}$ $\Gamma \vdash t: A[x := \text{true}]$ $\Gamma \vdash u: A[x := \text{false}]$ $\Gamma \vdash \text{if } n / x. A \text{ then } t \text{ else } u \Rightarrow A[x := n]$

Figure 3  $\Sigma ;\Gamma \vdash n\Rightarrow A$  Type inference for neutral terms

domains and terminating with  $A$ , and  $t\Gamma$  to indicate the term formed by  $t$  applied to all the variables in  $\Gamma$ . Moreover, every mention of a context and a signature is assumed to be valid according to the rules in Figure 5 and 4.

Throughout the paper, we will also concatenate whole contexts and signatures, e.g.  $\Sigma, \Xi$ .

# 3.4 Well-typed terms

The bidirectional typing checking rules are shown in figures 2 and 3. The type of neutral terms can be inferred, while canonical terms are checked. Our type theory includes a universe Set equipped with an inconsistent typing rule Set : Set for the sake of simplicity, but our presentation can be extended with stratified universes.

Finally, definitional equality of terms (needed to define the typing rules) is specified in figures 7 and 8. The conversion rules are performed in a type-directed way, so that it can respect the  $\eta$ -laws of functions.

# 3.5 Meta-variable substitutions

We specify typed meta-variable substitutions, a construct that will be useful to give a specification to our unification algorithm. A meta-variable substitution  $\theta$  from  $\Sigma$  to  $\Xi$  gives an instantiation to each meta-variable in  $\Sigma$ . The meta-variables in the instantiations are scoped over a new signature  $\Xi$ . The validity rule shown in figure 6 makes sure that the meta-variables instantiations are well-typed with respect to their type.

Applying a substitution  $\theta$  to a term  $t$  amounts to substitute each meta-variable for its instantiation in  $\theta$ , as specified in appendix B. Moreover, if the substitution is valid, if we have  $\Sigma; \Gamma \vdash t: A$  and  $\Xi \vdash \theta: \Sigma$ , we will have that

$$
\Xi ; \theta \Gamma \vdash \theta t: \theta A,
$$

where applying a substitution to a context amounts to applying it to all the types it contains.

Like with contexts and signatures, we will use, to also concatenate meta-variable substitutions. So for example if we have  $\Xi \vdash \theta : \Sigma$  and  $\Xi \vdash \eta : \Sigma'$ , we have that  $\Xi \vdash (\theta, \eta) : (\Sigma, \Sigma')$ .

$$
\overline {{\vdash \cdot}} \qquad \qquad \frac {\vdash \Sigma \qquad \Sigma ; \cdot \vdash A : \operatorname {S e t}}{\vdash \Sigma , \alpha : A} \qquad \overline {{\Sigma \vdash \cdot}} \qquad \qquad \frac {\Sigma \vdash \Gamma \qquad \Sigma ; \Gamma \vdash A : \operatorname {S e t}}{\Sigma \vdash \Gamma , x : A}
$$

Figure 4  $\boxed{1 - \Sigma}$  Well-formed signatures

Figure 5  $\Sigma \vdash \Gamma$  Well-formed contexts

$$
\begin{array}{c} \text {f o r a l l} (\alpha : A) \in \Sigma , \alpha := t \in \theta \text {a n d} \Xi ; \cdot \vdash t: \theta A \\ \hline \Xi \vdash \theta : \Sigma \end{array}
$$

Figure 6  $\Xi \vdash \theta : \Sigma$  Well-formed meta-variable substitutions

$$
\overline {{\Gamma \vdash \text {S e t} \equiv \text {S e t} : \text {S e t}}} \quad \overline {{\Gamma \vdash \text {B o o l} \equiv \text {B o o l} : \text {S e t}}} \quad \overline {{\Gamma \vdash \text {t r u e} \equiv \text {t r u e} : \text {B o o l}}}
$$

$$
\overline {{\Gamma \vdash \text {f a l s e} \equiv \text {f a l s e} : \text {B o o l}}} \quad \overline {{\Gamma \vdash (x : A _ {1}) \rightarrow B _ {1} \equiv (x : A _ {2}) \rightarrow B _ {2} : \text {S e t}}}
$$

$$
\frac {\Gamma , x : A \vdash f   x \equiv g   x : B}{\Gamma \vdash f \equiv g : (x : A) \rightarrow B} \quad \frac {\Gamma \vdash n \equiv n ^ {\prime} \Rightarrow A \quad \Gamma \vdash A \equiv B : \text {S e t}}{\Gamma \vdash n \equiv n ^ {\prime} : B}
$$

Figure 7  $\Sigma ;\Gamma \vdash t\equiv u:A$  Definitional equality of canonical terms

$$
\frac {\Gamma \vdash h \Rightarrow A}{\Gamma \vdash h \equiv h \Rightarrow A} \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad
$$

$$
\frac {\Gamma \vdash n \equiv n ^ {\prime} \Rightarrow \text {B o o l}}{\Gamma , x : \text {B o o l} \vdash A \equiv A ^ {\prime} : \text {S e t}} \quad \Gamma \vdash t \equiv t ^ {\prime}: A [ x := \text {t r u e} ] \quad \Gamma \vdash u \equiv u ^ {\prime}: A [ x := \text {f a l s e} ]}{\Gamma \vdash \text {i f} n / x . A \text {t h e n} t \text {e l s e} u \equiv \text {i f} n ^ {\prime} / x . A ^ {\prime} \text {t h e n} t ^ {\prime} \text {e l s e} u ^ {\prime} \Rightarrow A [ x := n ]}
$$

Figure 8  $\boxed{\Sigma; \Gamma \vdash n \equiv n' \Rightarrow A}$  Definitional equality of neutral terms

# 4 Unification

In this section we will give a specification for the unification algorithm that we will need to solve the constraints generated by elaboration.

# 4.1 Unification constraints

The input for the unification algorithm are heterogeneous constraints of the form

$$
\Gamma \vdash t: A = u: B.
$$

Such a constraint is well formed if we have that  $\Gamma \vdash t: A$  and  $\Gamma \vdash u: B$ . As we will see in Section 5, it is crucial for the constraints to be heterogeneous for the elaboration procedure to work as we intend to.

A constraint is solved if we have that  $\Gamma \vdash A \equiv B : \mathsf{Set}$  and  $\Gamma \vdash t \equiv u : A$ . This means that to solve a constraint the unifier will have to establish definitional equality of both the types and the terms.

# 4.2 Unification algorithm specification

A unification algorithm takes a signature and set of constraints, and attempts to solve them by instantiating meta-variables. Thus, unification rules will be of the form

$$
\Sigma , \mathcal {C} \rightsquigarrow \Xi , \theta
$$

Where  $\Sigma$  and  $\mathcal{C}$  are the input signature and constraints, and  $\Xi$  and  $\theta$  are the output signature and substitution, such that  $\Xi \vdash \theta : \Sigma$ . If the substitution solves all the constraints we have that

$$
\Xi \Vdash \theta \mathcal {C}.
$$

Note that unification might make no progress at all, and just return  $\Sigma$  and the identity substitution.

# 4.3 A suitable unification algorithm

Higher order unification in the context of dependently typed languages is still a poorly understood topic, and we do not have the space to discuss it in depth here. The basis for most of the unification algorithms employed in such languages is pattern unification, as introduced by Miller [8]. However in modern languages such as Agda or Coq there are factors complicating this process. The main inconvenience, as already mentioned in Section 1, is the fact that we cannot always know if a constraint is solvable, since solving other constraints might enable us to solve the current one. A algorithm that takes care of handling constraints under these assumptions is usually called dynamic.

However, another issue when unifying terms in these type theories is that definitional equality (specified by conversion rules such as the ones presented in this paper) often includes  $\eta$ -laws for functions and product types, and possibly other type-directed conversion rules. For this reason our constraints equate typed expressions.<sup>6</sup> Note that the types in the constraints are only needed so that we can abide by the  $\eta$  laws.

Ideally, to solve the heterogeneous constraints, a heterogeneous pattern unification algorithm is needed, such as the one described in chapter 4 of Adam Gundry's thesis [5]. However, in our prototype, we have found that implementing such an algorithm is impractical for performance reasons. In practice, a homogeneous pattern unification algorithm like the one employed in the Agda system works well enough in many of the examples that we have analysed. In this context, a heterogeneous constraint  $\Gamma \vdash t: A = u: B$  is converted to two homogeneous constraints,  $\Gamma \vdash A = B: \mathsf{Set}$  and  $\Gamma \vdash t = u: A$ . Some bookkeeping will be needed to ensure that the constraint equating the types is solved before attempting the one equating the terms, so that  $\Gamma \vdash t = u: A$  is considered only when it is well-formed—when we know that  $A \equiv B$ .

# 5 Type checking through unification

As mentioned in Section 2, our algorithm will elaborate a type-checking problem into a well-typed term and a set of unification constraints. Given some type-checking problem  $\Sigma; \Gamma \vdash t: A$ , the algorithm will elaborate it into a term  $u$  and constraints  $\mathcal{C}$ , along with an extended signature  $\Xi$ —since the elaboration process will add new meta-variables.

The algorithm is specified using rules of the form

$$
\llbracket \Sigma ; \Gamma \vdash t: A \rrbracket \rightsquigarrow \Xi , u, \mathcal {C},
$$

such that:

$\Xi$  is an extension of  $\Sigma$ ;

$u$  is well typed:  $\Xi ;\Gamma \vdash u:A$

$\mathcal{C}$  is a set of well formed unification constraints;

if unification produces a signature  $\Xi'$  and substitution  $\Xi' \vdash \theta : \Xi$  such that  $\Xi' \Vdash \theta C$ , we have that  $\Xi'; \theta \Gamma \vdash \theta t \equiv \theta u : \theta A$ . In other words, solving all the constraints restores definitional equality between the original term  $t$  and the original term  $u$ .

The main idea is to infer what the type must look like based on the term, and generate constraints that make sure that, if the constraints can be solved, that will be the case. For example, if faced with problem

$\Sigma ;\Gamma \vdash$  true:  $A$

we know that  $A$  must be Bool. However,  $A$  might be a type stuck on a meta-variable, as discussed in Section 2. At the same time, we want the elaboration procedure to immediately return a well-typed term. The heterogeneous constraints let us do just that: we will create a new meta-variable of type  $A$  in  $\Gamma$ , and use that as the elaborated term. Moreover we will return a constraint equating the newly created meta-variable to true:

$$
\begin{array}{l} \llbracket \Sigma ; \Gamma \vdash \text {t r e e}: A \rrbracket \rightsquigarrow \\ (\Sigma , \alpha : \Gamma \rightarrow A), \alpha \Gamma , \{\Gamma \vdash \text {t r u e}: \mathsf {B o o l} = \alpha \Gamma : A \} \\ \end{array}
$$

Note how we respect the contract of elaboration—the elaborated term is well-typed, the constraint is well-formed—without making any commitment on the shape of  $A$ .

For a more complicated example, consider the type-checking problem

$$
\Sigma ; \Gamma \vdash \lambda x \rightarrow t: A.
$$

We know that  $A$  needs to be a function type, but we do not know what the domain and codomain types are yet. To get around this problem we will add new meta-variables to the signature acting as the domain and codomain, then elaborate the body using those, and follow the same technique illustrated above to return a well-typed term by adding a new meta-variable:

-- Add meta-variables for the domain  $(\beta)$  and codomain  $(\gamma)$ :

$$
\Sigma_ {1} := \Sigma , \beta : \Gamma \rightarrow \operatorname {S e t}, \gamma : \Gamma \rightarrow (x: \beta) \rightarrow \operatorname {S e t}
$$

-- Elaborate the body of the abstraction:

$$
\llbracket \Sigma_ {1}; \Gamma , x: \beta \vdash t: \gamma \Gamma x \rrbracket \rightsquigarrow \Sigma_ {2}, u, \mathcal {C}
$$

-- Add meta-variable that we will return as the elaborated term:

$$
\Sigma_ {3} := \Sigma_ {2}, \alpha : \Gamma \rightarrow A
$$

-- Return the appropriate constraint equating the abstracted elaborated body to the new

-- meta-variable, together with the constraints generated from elaborating the body:

$$
\llbracket \Sigma ; \Gamma \vdash \lambda x \rightarrow t: A \rrbracket \rightsquigarrow \Sigma_ {4},
$$

$$
\alpha \Gamma ,
$$

$$
\left\{\Gamma \vdash (\lambda x \rightarrow u): (x: \beta \Gamma) \rightarrow \gamma \Gamma x = \alpha \Gamma : A \right\} \cup \mathcal {C}
$$

Note how the use of heterogeneous equality is crucial if we want to avoid to ever commit to the types having a particular shape, while having all the constraints to be well-formed immediately.

Every rule in full algorithm is going to follow the general pattern that emerged above:

(a) Elaborate sub-terms, adding meta-variables to have types to work with;

(b) Add a meta-variable serving as the elaborated term, say  $\alpha$ ;

(c) Return a constraint equating  $\alpha$  to a term properly constructed using the elaborated subterms; together with the constraints returned by elaborating said subterms.

For brevity we present the full algorithm using an abbreviated notation that implicitly threads the signatures  $(\Sigma, \Sigma_1, \Sigma_2, \text{and} \Sigma_3$  in the example above) across rules. We will also use the macro  $\mathrm{FRESH}(\_, \_)$  to add new meta-variables in a context, such that  $\alpha := \mathrm{FRESH}(\Gamma, A)$  is equivalent to  $\Xi := \Sigma, \alpha: \Gamma \to A$ , and successive appearances of  $\alpha$  are automatically applied to  $\Gamma$ , and where  $\Sigma$  and  $\Xi$  are the old and new signature—which are, as said, implicitly threaded. Finally, we implicitly collect the constraints generated when elaborating the subterms, and implicitly add a meta-variable that stands for the elaborated term, together with an appropriate constraint—steps (b) and (c) in the process described above. $^8$  For example, the rule to elaborate abstractions, explained before, will be shown as

$$
\begin{array}{l} \beta := \operatorname {F R E S H} (\Gamma , \operatorname {S e t}) \quad \gamma := \operatorname {F R E S H} (\Gamma , x: \beta , \operatorname {S e t}) \\ [   [ \Gamma , x: \beta \vdash t: \gamma ]   ] \rightsquigarrow u \\ \overline {{[ \Gamma \vdash \lambda x \rightarrow t : A ]}} \rightsquigarrow (\lambda x \rightarrow u): (x: \beta) \rightarrow \gamma \\ \end{array}
$$

The complete algorithm is shown in figure 9. They are remarkably similar to the typing rules, however instead of matching directly on the type we expect we match through constraints.

$$
\begin{array}{l} \overline {{[ \Gamma \vdash \operatorname {S e t} : A ] \rightsquigarrow \operatorname {S e t} : \operatorname {S e t}}} \quad \overline {{[ \Gamma \vdash \operatorname {B o o l} : A ] \rightsquigarrow \operatorname {B o o l} : \operatorname {S e t}}} \quad \overline {{[ \Gamma \vdash \operatorname {t r u e} : A ] \rightsquigarrow \operatorname {t r u e} : \operatorname {B o o l}}} \\ \begin{array}{l}\frac {\llbracket \Gamma \vdash A : \text {S e t} \rrbracket \rightsquigarrow A ^ {\prime} \quad \Gamma , x : A ^ {\prime} \vdash B : \text {S e t} \rightsquigarrow B ^ {\prime}}{\llbracket \Gamma \vdash (x : A) \rightarrow B : S \rrbracket \rightsquigarrow (x : A ^ {\prime}) \rightarrow B ^ {\prime} : \text {S e t}}\end{array} \\ \beta := \operatorname {F R E S H} (\Gamma , \mathbf {S e t}) \quad \gamma := \operatorname {F R E S H} (\Gamma , x: \beta , \mathbf {S e t}) \\ \frac {\llbracket \Gamma , x : \beta \vdash t : \gamma \rrbracket \rightsquigarrow u}{\llbracket \Gamma \vdash \lambda x \rightarrow t : A \rrbracket \rightsquigarrow (\lambda x \rightarrow u) : (x : \beta) \rightarrow \gamma} \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad x: A \in \Gamma} {\llbracket \Gamma \vdash x \rrbracket \rightsquigarrow x: A} \\ \begin{array}{c c}&\beta := \mathrm {F R E S H} (\Gamma , \mathsf {S e t}) \qquad \gamma := \mathrm {F R E S H} (\Gamma , x: \beta , \mathsf {S e t})\\\frac {\alpha : A \in \Sigma}{[   [ \Gamma \vdash \alpha ]   ] \rightsquigarrow \alpha : A}&\frac {[   [ \Gamma \vdash n : (x : \beta) \to \gamma ]   ] \rightsquigarrow t \qquad [   [ \Gamma \vdash u : \beta ]   ] \rightsquigarrow v}{[   [ \Gamma \vdash n   u : A ]   ] \rightsquigarrow t   v : \gamma [ x := v ]}\end{array} \\ \frac {\llbracket \Gamma , x : \mathsf {B o o l} \vdash B : \mathsf {S e t} \rrbracket \rightsquigarrow B ^ {\prime}}{\llbracket \Gamma \vdash u : B ^ {\prime} [ x := \mathsf {t r u e} ] \rrbracket \rightsquigarrow u ^ {\prime}} \quad \llbracket \Gamma \vdash v : B ^ {\prime} [ x := \mathsf {f a l s e} ] \rrbracket \rightsquigarrow v ^ {\prime}} \\ \end{array}
$$

Figure 9  $\boxed{[[\Sigma ;\Gamma \vdash t:A]]\rightsquigarrow \Xi ,u,\mathcal{C}}$  Elaboration

The rules can easily be turned into an algorithm which pattern matches on the term and decides how to proceed. Naturally the algorithm can still fail if it encounters an out of scope meta-variable or variable, although in real systems scope checking is usually performed beforehand.

# 5.1 Examples

We will explore how the algorithm works by going through various common situations. The reader can experiment using the mentioned tog tool, passing the -d 'elaborate' command-line flag to have it to print out the generated constraints. A wealth of examples are present in the repository. We will assume the usage of pattern unification to solve constraints when examining the examples.

# 5.1.1 A simple problem

Let's take type-checking problem

$$
\therefore \cdot \vdash \text {t r u e}: \text {B o o l}.
$$

The algorithm will return the triple

$$
\alpha : \text {B o o l}, \alpha , \{\cdot \vdash \text {t r u e}: \text {B o o l} = \alpha : \text {B o o l} \}
$$

The constraint is immediately solvable, yielding the substitution  $\alpha \coloneqq \text{true}$ , which will restore definitional equality between the elaborated term and true.

# 5.1.2 An ill-typed problem

Now for something that should fail. Given

add: Nat  $\rightarrow$  Nat  $\rightarrow$  Nat,

we want to solve

$\therefore x:\mathrm{Nat}\vdash addx:\mathrm{Nat}.$

The algorithm will return the triple

$\Sigma, \zeta, x, \mathcal{C}$  where

$$
\begin{array}{l} \Sigma = \alpha : \mathsf {N a t} \rightarrow \mathsf {N a t}, \beta : (x: \mathsf {N a t}) \rightarrow \mathsf {N a t} \rightarrow \mathsf {S e t}, \gamma : (x: \mathsf {N a t}) \rightarrow \alpha x, \\ \delta : (x: \mathsf {N a t}) \to (y: \alpha x) \to \beta x y, \zeta : \mathsf {N a t} \to \mathsf {N a t} \\ \end{array}
$$

$$
\begin{array}{l} \mathcal {C} = \{x: \mathrm {N a t} \vdash \delta x (\gamma x): \beta x (\gamma x) = \zeta x: \mathrm {N a t}, \\ x: \mathrm {N a t} \vdash a d d: \mathrm {N a t} \rightarrow \mathrm {N a t} \rightarrow \mathrm {N a t} = \delta x: (y: \alpha x) \rightarrow \beta x y, \\ x: \operatorname {N a t} \vdash x: \operatorname {N a t} = \gamma x: \alpha x \} \\ \end{array}
$$

While looking scary at first, the meaning of the meta-variables and constraints is easy to interpret, keeping in mind that we generate one constraint per subterm (including the top level term).

At the top level, we elaborate the two subterms  $add$  and  $x$ . We know that  $add$  must be a function type, since it is applied to something; and that the type of  $x$  must match the type of the domain of said function type. Thus, two meta-variables are created to represent the domain and codomain— $\alpha$  and  $\beta$ . Then,  $add$  and  $x$  are elaborated with said types, which in turn requires the addition of  $\gamma$  and  $\delta$ , serving as elaborated terms. These are the ingredients for the second and third constraint. Finally, the elaborated  $\delta$  (representing  $add$ ) is applied to  $\gamma$  (representing  $x$ ), and equated to a new meta-variable  $\zeta$ , which is the result of the top-level elaboration.

The constraints reflect the fact that the term is ill-typed:  $\beta$  is equated both to Nat (in the first constraint), and to Nat  $\rightarrow$  Nat, in the second constraint. Thus, unification will fail.

# 5.1.3 An unsolvable problem

Finally, let's go back to an example which cannot immediately be solved in its entirety:

$\alpha :\mathsf{Nat};\cdot \vdash (\mathsf{true},0):B o o l O r \mathsf{N a t}\alpha \times \mathsf{N a t}.$

The desired outcome for this problem is to type check the second element of the pair, 0; but "suspend" the type checking of the first element by replacing refl with a meta-variable. Running the type-checking problem through the elaboration procedure yields

$\Sigma ,\zeta x,\mathcal{C}$  where

$$
\Sigma = \beta : \operatorname {S e t}, \gamma : \operatorname {S e t}, \delta : \beta , \zeta : \gamma , \iota : \operatorname {B o o l O r N a t} \alpha \times \operatorname {N a t}
$$

$$
\begin{array}{l} \mathcal {C} = \{\cdot \vdash (\delta , \zeta): \beta \times \gamma = \iota : B o o l O r N a t \alpha \times N a t, \\ \cdot \vdash 0: \mathrm {N a t} = \zeta : \gamma , \\ \cdot \vdash \operatorname {t r u e}: \operatorname {B o o l} = \delta : \beta \} \\ \end{array}
$$

The second and third constraints regard the two sub-problems individually, and are solvable yielding the substitution

$$
\beta := \text {B o o l}, \delta := \text {t r u e}, \gamma := \text {N a t}, \zeta := 0,
$$

and leaving us with

-  $\vdash$  (true, 0):  $\mathsf{Bool} \times \mathsf{Nat} = \iota$ :  $\mathsf{BoolOrNat} \alpha \times \mathsf{Nat}$ .

At this point the unifier will be able to substitute  $\iota$  with a pair

-  $\vdash$  (true, 0): Bool  $\times$  Nat =  $(\xi, 0)$ : BoolOrNat  $\alpha \times$  Nat.

Now solving the constraint amounts to solve

-  $\vdash$  true:  $\mathsf{Bool} = \xi : \mathsf{BoolOrNat}\alpha$ ,

but the unifier is not going to be able to make progress, since substituting  $\xi$  for true will leave the constraint ill-formed. Thus, the final result of the elaboration and unification will be  $(\xi, 0)$ , which is all we could hope for.

# 5.2 Some properties

$\triangleright$  Lemma 1 (Well-formedness and functionality of elaboration). Let  $\vdash \Sigma$  and  $\Sigma \vdash \Gamma$ .

1. There uniquely exist a signature  $\Xi$ , constraints  $\mathcal{C}$ , a term  $t'$ , and a type  $A$  such that

$$
\llbracket \Sigma ; \Gamma \vdash t \rrbracket \rightsquigarrow \Xi \mid \mathcal {C} \vdash t ^ {\prime} \Rightarrow A
$$

and  $\Xi ;\Gamma \vdash A:\mathrm{Set}$

2. If  $\Sigma; \Gamma \vdash A: \mathsf{Set}$ , then there uniquely exist a signature  $\Xi$ , constraints  $\mathcal{C}$ , and a term  $t'$  such that

$$
\llbracket \Sigma ; \Gamma \vdash t \Leftarrow A \rrbracket \rightsquigarrow \Xi \mid \mathcal {C} \vdash t ^ {\prime}.
$$

In both cases,  $\Xi$  is necessarily an extension of  $\Sigma$  and all the outputs are well-formed, meaning  $\vdash \Xi$  and  $\Xi; \Gamma \vdash t': A$  and  $\Xi; \Gamma \vdash C$ .

Proof. By induction on  $t$ .

$\triangleright$  Lemma 2 (Soundness of elaboration).

If one of

$$
[   [ \Sigma ; \Gamma \vdash t ]   ] \rightsquigarrow \Xi \mid \mathcal {C} \vdash t ^ {\prime} \Rightarrow A
$$

$$
\llbracket \Sigma ; \Gamma \vdash t \Leftarrow A \rrbracket \rightsquigarrow \Xi \mid \mathcal {C} \vdash t ^ {\prime}
$$

and there is some well-typed meta substitution  $\Sigma' \vdash \theta : \Xi$  that solves the constraints, i.e.,  $\Sigma' \Vdash \theta C$ , then

$$
\Sigma^ {\prime}, \theta \Gamma \vdash \theta t \equiv \theta t ^ {\prime}: \theta A.
$$

Proof. By induction on term  $t$ .

$\triangleright$  Lemma 3 (Strong soundness of elaboration).

1. If

$$
\llbracket \Sigma ; \Gamma \vdash t \rrbracket \rightsquigarrow \Xi \mid \mathcal {C} \vdash t ^ {\prime} \Rightarrow A
$$

and there is some closing untyped substitution  $\sigma$  such that  $\mathsf{dom}(\sigma) \supseteq \mathsf{dom}(\Xi)$  and  $\vdash \sigma : \Sigma$  and  $\sigma \Gamma \vdash \sigma A : \mathsf{Set}$  and  $\sigma$  solves the untyped constraints, then

$$
\sigma \Gamma \vdash \sigma t \equiv \sigma t ^ {\prime}: \sigma A.
$$

2. If

$$
\llbracket \Sigma ; \Gamma \vdash t \Leftarrow A \rrbracket \rightsquigarrow \Xi \mid \mathcal {C} \vdash t ^ {\prime}
$$

and there is some closing untyped substitution  $\sigma : \Xi$  that is well-typed for  $\Sigma$ , i.e.,  $\vdash \sigma : \Sigma$  and solves the untyped constraints, i.e.,  $\Vdash \sigma C$ , then

$$
\sigma \Gamma \vdash \sigma t \equiv \sigma t ^ {\prime}: \sigma A.
$$

Proof. By induction on term  $t$ .

Case Abstraction  $\lambda x\to t$

$$
\frac {\llbracket (\Sigma , \alpha : (\Gamma \to \mathsf {S e t})) ; (\Gamma , x : (\alpha \Gamma)) \vdash t \rrbracket \rightsquigarrow \Xi \mid \mathcal {C} \vdash t ^ {\prime} \Rightarrow B}{\llbracket \Sigma ; \Gamma \vdash (\lambda x \to t) \rrbracket \rightsquigarrow \Xi \mid \mathcal {C} \vdash (\lambda x \to t ^ {\prime}) \Rightarrow ((x : \alpha \Gamma) \to B)}
$$

By assumption  $\vdash \sigma : \Sigma$  and  $\sigma \Gamma \vdash \sigma((x : \alpha \Gamma) \to B) : \mathsf{Set}$ , which by inversion gives us  $\sigma \Gamma \vdash (\sigma \alpha) \Gamma : \mathsf{Set}$  and  $\sigma(\Gamma, x : \alpha \Gamma) \vdash \sigma B : \mathsf{Set}$ . Thus  $\vdash \sigma \alpha : (\sigma \Gamma \to \mathsf{Set})$  and  $\vdash \sigma : (\Sigma, \alpha : (\Gamma \to \mathsf{Set}))$ . By induction hypothesis,  $\sigma \Gamma, x : \sigma(\alpha \Gamma) \vdash \sigma t = \sigma t' : \sigma B$ , thus by the  $\xi$  rule for equality,  $\sigma \Gamma \vdash \sigma(\lambda x \to t) = \sigma(\lambda x \to t') : \sigma((x : \alpha \Gamma) \to B)$ .

Case Application  $tu$

$$
\begin{array}{c}\llbracket \Sigma ; \Gamma \vdash u \rrbracket \rightsquigarrow \Sigma_ {1} \mid \mathcal {C} _ {1} \vdash u ^ {\prime} \Rightarrow A\\\llbracket \Sigma_ {1}, \beta : ((\Gamma , x: A) \to \mathsf {S e t}); \Gamma , x: A \vdash t \Leftarrow ((x: A) \to \beta \Gamma x) \rrbracket \rightsquigarrow \Sigma_ {2} \mid \mathcal {C} _ {2} \vdash t ^ {\prime}\\\hline \llbracket \Sigma ; \Gamma \vdash t u \rrbracket \rightsquigarrow \Sigma_ {2} \mid \mathcal {C} _ {1} \cup \mathcal {C} _ {2} \vdash t ^ {\prime} u ^ {\prime} \Rightarrow \beta \Gamma u ^ {\prime}\end{array}
$$

By the first induction hypothesis,  $\sigma \Gamma \vdash \sigma u = \sigma u': \sigma A$ . By the second induction hypothesis

$\triangleright$  Lemma 4 (Completeness of elaboration). Let us assume a term  $t$  and a well-formed signature  $\Sigma$  and  $\Sigma \vdash \Gamma$  and a second signature  $\Xi$  and a substitution  $\Xi \vdash \theta : \Sigma$  such that  $\Xi; \theta \Gamma \vdash \theta t: C$ .

1. Then

$$
\llbracket \Sigma ; \Gamma \vdash t \rrbracket \rightsquigarrow (\Sigma , \Sigma^ {\prime}) \mid \mathcal {C} \vdash t ^ {\prime} \Rightarrow B
$$

and there exists a substitution  $\theta^{\prime}$  such that

$$
\begin{array}{l} \Xi \vdash (\theta , \theta^ {\prime}): (\Sigma , \Sigma^ {\prime}) \\ \Xi \Vdash (\theta , \theta^ {\prime}) \mathcal {C} \\ \Xi ; \theta \Gamma \vdash C = \left(\theta , \theta^ {\prime}\right) B: S e t \\ \Xi ; \theta \Gamma \vdash \theta t = (\theta , \theta^ {\prime}) t ^ {\prime}: C. \\ \end{array}
$$

2. Further, if  $\Sigma; \Gamma \vdash A: \text{Set and } \Xi; \theta \Gamma \vdash \theta A = C: \text{Set, then}$

$$
\llbracket \Sigma ; \Gamma \vdash t \Leftarrow A \rrbracket \rightsquigarrow (\Sigma , \Sigma^ {\prime}) \mid \mathcal {C} \vdash t ^ {\prime}
$$

and there exists a substitution  $\theta^{\prime}$  such that

$$
\begin{array}{l} \Xi \vdash (\theta , \theta^ {\prime}): (\Sigma , \Sigma^ {\prime}) \\ \Xi \Vdash (\theta , \theta^ {\prime}) \mathcal {C} \\ \Xi ; \theta \Gamma \vdash \theta t = (\theta , \theta^ {\prime}) t ^ {\prime}: C. \\ \end{array}
$$

In other words, if it's possible to instantiate some meta-variables to make  $t$  well-typed, then all the constraints generated by the elaboration procedure are solvable.

Proof. By induction on  $t$ .

$\triangleright$  Corollary 5 (Simple inference). If  $\Sigma; \Gamma \vdash t: A$  and  $\llbracket \Sigma; \Gamma \vdash t\rrbracket \rightsquigarrow (\Sigma, \Sigma') \mid \mathcal{C} \vdash t' \Rightarrow A'$ , then all the constraints in  $\mathcal{C}$  are solvable by some substitution  $\Sigma \vdash \theta': \Sigma'$  and  $\Sigma; \Gamma \vdash A = \theta'A': \text{Set}$ .

Proof. From Completeness with  $\Xi = \Sigma$  and identity substitution  $\theta$ ,

$\triangleright$  Corollary 6 (Simple checking). If  $\Sigma; \Gamma \vdash t: A$  and  $\llbracket \Sigma; \Gamma \vdash t \Leftarrow A\rrbracket \rightsquigarrow (\Sigma, \Sigma') \mid \mathcal{C} \vdash t'$ , then all the constraints in  $\mathcal{C}$  are solvable.

Proof. From Completeness with  $\Xi = \Sigma$  and identity substitution  $\theta$ .

# 5.2.1 Effectiveness

While the properties above guarantee establish some basic results about the algorithm, they are all also satisfied by the very useless elaboration algorithm

$$
\llbracket \Sigma ; \Gamma \vdash t: A \rrbracket \rightsquigarrow (\Sigma , \alpha : \Gamma \rightarrow A, \beta : \Gamma \rightarrow \mathsf {S e t}), \alpha \Gamma , \{\Gamma \vdash \alpha \Gamma : A = t: \beta \Gamma \}.
$$

However, the intent of the developed algorithm is to be as effective, when used with pattern unification, as the current techniques to type check dependent types with meta-variables.

To achieve this, it has been designed so that the generated constraints fall in the pattern fragment when existing type checkers would be able to make progress, and by testing the algorithm "in the wild" with existing Agda programs we have found it effective in practice. For instance, if we did not keep our terms in  $\beta$ -normal form, we could not elaborate applications into constraints falling into the pattern fragment, due to the fact that we cannot reliably infer the type of the function.

However, future work should involve a formal characterization of completeness in the context of type checkers for dependent types with meta-variables, and a proof that our algorithm is indeed complete.

# 6 Additional remarks

# 6.1 Additional features

In this section we will briefly sketch how to fit popular features into the framework described. The general idea is to do everything which doesn't require normalization in the elaboration procedure, and the rest into the unifier.

# 6.1.1 Implicit arguments

We have already implemented a restricted form of implicit arguments, which we call "type schemes" in line with ML terminology. Type schemes allow the user to define a number of implicit arguments in top-level definitions, for example the already mentioned

$$
h e a d: \{A: \mathbf {S e t} \} \rightarrow \{n: \mathbf {N a t} \} \rightarrow \mathbf {V e c} A (1 + n) \rightarrow A.
$$

Under this scheme, every occurrence of head is statically replaced with head --, before even elaborating--we do it while scope checking. However this is obviously limited, since we can only have implicit arguments before any explicit ones and only for top-level definitions.

We want to enable a more liberal placement of implicit arguments. This is achieved in Agda by allowing implicit arguments in all types, and in any many positions. The details of the implementation are still in flux in Agda itself, but the core idea is to type-check function application and abstractions bidirectionally, by first looking at the type and inserting implicit arguments if needed. So elaborating  $t u$  where  $t: \{x:A\} \to (y:B) \to C$  will result in  $t - u$ . Similarly, elaborating  $t: \{x:A\} \to B$  will result in  $\lambda \{x\} \to t$ , where  $\{x\}$  binds an implicit arguments.

We are exploring two ways to integrate this kind of mechanism in our framework:

Mimic the bidirectional type-checking performed in Agda and similar systems closely, by adding a new kind of constraint for function application and abstraction which waits on the type to have a rigid head, that is to say a type not blocked on a meta-variable.

- Alternatively, force all implicit arguments to appear before an explicit one (with the exception of type schemes), and always include an implicit arguments in  $\rightarrow$ -types. $^{10}$  Multiple implicit arguments will then be handled by one implicit argument carrying a tuple.

We are currently implementing the latter proposal, since it is simpler to describe and to implement, although only using it will tell if it is practical.[11]

# 6.1.2 Type classes

Type classes, as employed by Haskell, were introduced to handle overloaded operators in programming languages [12]. Other similar structures include canonical structures in Coq. In short, type classes let the user specify a collection of methods that can be implemented for a specific type. For example, the type class identifying monoid is defined as

```txt
class Monoid a where  
    mempty: a  
    mappend:  $a \to a \to a$   
-- Monoid instance for list  
instance Monoid [a] where  
    mempty = [] -- Empty list  
    mappend = (+) -- Concatenation  
-- Monoid instance for pairs of monoids  
instance (Monoid a, Monoid b)  $\Rightarrow$  Monoid (a, b) where  
    mempty = (mempty, mempty)  
    mappend  $(x_1, y_1)$ $(x_2, y_2) = (x_1 \text{`mappend} x_2, y_1 \text{`mappend} y_2)$
```

Type classes are a form of type-directed name resolution, and thus cannot be resolved at elaboration time—we might need to instantiate meta-variables before being able to resolve the right method. To integrate it in our framework we have to include type-classes into our unification procedure. Luckily, this is exactly what the authors of the theorem prover Matita accomplished using what they dubbed unification hints [1]. Briefly, the unifier is given "hint" on how to solve problems that it cannot resolve by itself, and such hints are repeatedly tried if unification fails.

Similar to type-classes, overloaded constructors are a feature introduced by Agda, that lets the user define multiple data constructors with the same name. When such an overloaded constructor is used, its type must be determined by the type we are type checking it against. It is easy to see how this problem is essentially the same as resolving the right type class instance when encountering one of its methods—the type-class being “data types with the same constructors”, the instances being the data-types, and the methods being the constructors—, and thus we plan to implement this feature using unification hints as well.

# 6.2 Performance

One reason for concern is that our algorithm generates more constraints than ordinary type-checking algorithms. However, as already remarked, our algorithm generates a number of constraints and meta-variables which is linear in the size of the input term. Moreover, we would expect the unifier to spend little time solving the trivial constraints which are normally handled by the type-checker directly.

In the examples we have collected, we have found that this is the case, and the run time is dominated by unification filling in implicit arguments which can become very large. More specifically, most of the time is spent dealing with  $\eta$ -expansion, which we plan to improve in the future.

# 7 Conclusion

We have presented an algorithm that leverages the unifier, an important part of already existing dependently typed programming languages and theorem provers, to greatly simplify the process of type checking. The expressivity of higher-order unification lets us specify the type-rules concisely. Moreover, we have clearly separated type checking from unification, allowing for greater modularity.

We have implemented the ideas presented in the tog, covering a large subset of the Agda languages. We are currently in the process of improving to get narrow the gap between its capabilities and Agda.

# 7.1 Acknowledgements and related work

This work is a continuation of the work by Norell & Coquand [10], which describes how Agda deals with issues that we presented. In fact, the algorithm described here is a simpler re-implementation of what they specified.

The other main inspiration came from a discussion with Adam Gundry about how Epigram 2 deals with type checking in the presence of meta-variables. The propositional equality Epigram 2 is powerful enough to represent constraints stuck on some meta-variable as an unfinished equality proof. Thus, the unifier, when given a constraint  $\Gamma \vdash t: A = u: B$  produces a—possibly unfinished—proof that  $\Gamma \vdash t: A \equiv u: B$ , where here  $\equiv$  denotes Epigram's heterogeneous propositional equality. This proof can be used to "transport" terms on one side of the equation to the other. From this discussion I realised that such a powerful equality was not needed to implement a similar system.

The already cited work on Matita [1] convinced us further that isolating "dynamic" procedures in the unifier is a good idea.

Finally, our work follows a long tradition of separating elaboration of the user syntax into a core type theory, and the type-checking of such theory. As far as we know this line of work

Set[h := t]  $\rightsquigarrow$  Set  $\overline{\text{Bool}[h:=t] \rightsquigarrow \text{Bool}}$  true[h := t]  $\rightsquigarrow$  true false[h := t]  $\rightsquigarrow$  false

$$
\frac {A [ h : = t ] \rightsquigarrow A ^ {\prime} \quad B [ h : = t ] \rightsquigarrow B ^ {\prime}}{((x : A) \to B) [ h : = t ] \rightsquigarrow (x : A ^ {\prime}) \to B ^ {\prime}} \qquad \qquad \frac {u [ h : = t ] \rightsquigarrow u ^ {\prime}}{(\lambda x \to u) [ h : = t ] \rightsquigarrow \lambda x \to u ^ {\prime}}
$$

$$
\overline {{h [ h : = t ] \rightsquigarrow t}} \qquad \frac {h \not \equiv h ^ {\prime}}{h ^ {\prime} [ h : = t ] \rightsquigarrow h ^ {\prime}} \qquad \frac {n [ h : = t ] \rightsquigarrow v \quad u [ h : = t ] \rightsquigarrow u ^ {\prime} \quad v u ^ {\prime} \rightsquigarrow v ^ {\prime}}{(n   u) [ h : = t ] \rightsquigarrow v ^ {\prime}}
$$

$$
\begin{array}{l l}n [ h := t ] \rightsquigarrow w&A [ h := t ] \rightsquigarrow A ^ {\prime} \quad u [ h := t ] \rightsquigarrow u ^ {\prime} \quad v [ h := t ] \rightsquigarrow v ^ {\prime}\\&\text {i f} w / x. A ^ {\prime} \text {t h e n} u ^ {\prime} \text {e l s e} v ^ {\prime} \rightsquigarrow w ^ {\prime}\end{array}
$$

$$
\overline {{(\text {i f} n / x . A \text {t h e n} u \text {e l s e} v) [ h := t ] \rightsquigarrow w ^ {\prime}}}
$$

Figure 10  $\boxed{u[h:=t]\rightsquigarrow u^{\prime}}$  and  $\boxed{n[h:=t]\rightsquigarrow u}$  Hereditary substitution into canonical and neutral terms

goes back at least to Coquand and Huet's "Constructive Engine" [6], with its separation between the "concrete" user syntax and the internal "abstract" syntax.

Moreover, we'd like to thank Andrea Vezzosi, Nils Anders Danielsson, Conor McBride, and Bas Spitters for the useful input.

# A Syntax and types used in examples

Throughout the examples we use a syntax close to the one in Agda and Haskell. Some details regarding the syntax:

type and data constructors are shown in a sans serif font;

new meta-variables are introduced using underscores  $(\_)$

- binary operators are referred to with parentheses, e.g.  $(+)$ ;

implicit arguments are indicated by curly braces;

- definitions can be defined by pattern matching.

We use some standard types, namely:

Set: Set—Set is the type of all types, and its type is Set itself;

- Bool: Set, inhabited by true and false;

Nat: Set, representing the natural numbers, introduced by number literals (1, 2, etc.);

$(\equiv): \{A: \mathsf{Set}\} \to A \to A \to \mathsf{Set}$ , the identity type; inhabited by  $\mathsf{refl}: \{A: \mathsf{Set}\} \to \{x: A\} \to x \equiv x$ .

# B Substitution and term elimination

Figure 10 show the rules to substitute a term  $u$  for a head  $h$ , which can be a variable  $x$  or a meta-variable  $\alpha$ . Substituting  $(n u)[h := t]$  into proper neutral terms  $n t$  might (in case the head of  $n$  is  $h$ ) generate redexes, which are eliminated by invocations of the term elimination judgment  $t u \rightsquigarrow v$  and if  $t / x.A$  then  $u$  else  $v \rightsquigarrow t$ , whose rules are given respectively in Figure 11 and Figure 12. Term elimination in turn invokes substitution when the eliminated term is a  $\lambda$ -abstraction.

While we use explicit names in our rules, we do not address issues related to  $\alpha$ -renaming here. In our prototype substitution is implemented using de Bruijn indices [4].

$$
\frac {t [ x : = u ] \rightsquigarrow t ^ {\prime}}{(\lambda x \rightarrow t) u \rightsquigarrow t ^ {\prime}}
$$

Figure 11  $t u \rightsquigarrow v$  Application elimination

(if true /x.A then t else u)  $\rightsquigarrow$  t

(if false /x.A then t else u)  $\rightsquigarrow$  u

Figure 12 if  $t / x.A$  then  $u$  else  $v\rightsquigarrow t$  Bbool elimination
