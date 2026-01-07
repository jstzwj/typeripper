# Type Inference for Records in a Natural Extension of ML

Didier Rémy  
INRIA-Rocquencourt*

# Abstract

We describe an extension of ML with records where inheritance is given by ML generic polymorphism. All common operations on records but concatenation are supported, in particular the free extension of records. Other operations such as renaming of fields are added. The solution relies on an extension of ML, where the language of types is sorted and considered modulo equations, and on a record extension of types. The solution is simple and modular and the type inference algorithm is efficient in practice.

# Introduction

The aim of typechecking is to guarantee that well-typed programs will not produce runtime errors. A type error is usually due to a programmer's mistake, and thus typechecking also helps him in debugging his programs. Some programmers do not like writing the types of their programs by hand. In the ML language for instance, type inference requires as little type information as the declaration of data structures; then all types of programs will be automatically computed.

Our goal is to provide type inference for labeled products, a data structure commonly called records, allowing some inheritance between them: records with more labels should be allowed where records with fewer labels are required.

After defining the operations on records and recalling related work, we first review the solution for a finite (and small) set of labels, which was presented in [Rém89], then we extend it to a denumerable set of labels. In the last part we discuss the power and weakness of the solution, we describe some variations, and suggest improvements.

Without records, data structures are built using product types, as in ML, for instance.

("Peter", "John", "Professor", 27, 5467567, 56478356, ("toyota", "old", 8929901))

With records one would write, instead:

name  $=$  "Peter";lastname  $\equiv$  "John";job  $=$  "Professor";age  $= 27$  ;id  $= 5467567$

license  $= 56478356$  vehicle  $=$  {name  $\equiv$  "Toyota";id  $= 8929901$  ;age  $\equiv$  "old"}}

The latter program is definitely more readable than the former. It is also more precise, since components are named. Records can also be used to name several arguments or several results of a function. More generally, in communication between processes records permit the naming of the different ports on which processes can exchange information. One nice example of this is the LCS language [Ber88], which is a combination of ML and Milner's CCS [Mil80].

Besides typechecking records, the challenge is to avoid record type declarations and fix size records. Extensible records introduced by Wand [Wan89, CM89] can be built from older records by adding new fields. This feature is the basis of inheritance in the view of objects as records [Wan89, CM89].

The main operations on records are introduced by examples, using a syntax similar to CAML syntax [CH89, Wei89]. Like variable names, labels do not have particular meanings, though choosing good names (good is subjective) helps in writing and reading programs. Names can, of course, be reused in different records, even to build fields of different types. This is illustrated in the following three examples:

$$
l e t \quad c a r = \left\{n a m e = ^ {\prime \prime} T o y o t a ^ {\prime \prime}; a g e = ^ {\prime \prime} o l d ^ {\prime \prime}; i d = 7 8 6 6 \right\};;
$$

$$
l e t \quad t r u c k = \left\{n a m e = ^ {\prime \prime} B l a z e r ^ {\prime \prime}; i d = 6 5 8 7 8 6 7 5 6 7 \right\};;
$$

$$
l e t \quad p e r s o n = \left\{n a m e = ^ {\prime \prime} T i m ^ {\prime \prime}; a g e = 3 1; i d = 5 6 5 6 7 8 7 \right\};
$$

Remark that no declaration is required before the use of labels. The record person is defined on exactly the same fields as the record car, though those fields do not have the same intuitive meaning. The field age holds values of different types in car and in person.

All these records have been created in one step. Records can also be build from older ones. For instance, a value driver can be defined as being a copy of the record person but with one more field, vehicle, filled with the previously defined car object.

let driver = {person with vehicle = car};

Note that there is no sharing between the records person and driver. You can simply think as if the former were copied into a new empty record before adding a field car to build the latter. This construction is called the extension of a record with a new field. In this example the newly defined field was not present in the record person, but that should not be a restriction. For instance, if our driver needs a more robust vehicle, we write:

let truck_driver = {driver with vehicle = truck};;

As previously, the operation is not a physical replacement of the vehicle field by a new value. We do not wish the old and the new value of the vehicle field to have the same type. To distinguish between the two kinds of extensions of a record with a new field, we will say that the extension is strict when the new field must not be previously defined, and free otherwise.

A more general operation than extension is concatenation, which constructs a new record from two previously defined ones, taking the union of their defined fields. If the car has a rusty body but a good engine, one could think of building the hybrid vehicle:

let repaired_truck = {car and truck};

This raises the question: what value should be assigned to fields which are defined in both car and truck? When there is a conflict (the same field is defined in both records), priority could be given to the last record. As with free extension, the last record would eventually overwrite fields of the first one. But one might also expect a typechecker to prevent this situation from happening. Although concatenation is less common in the literature, probably because it causes more trouble, it seems interesting in some cases. Concatenation is used in the standard ML language [HMT91] when a structure is opened and extended with another one. In the LCS language, the visible ports of two processes run in parallel are exactly the ports visible in any of them. And as shown by Mitchell Wand [Wan89] multiple inheritance can be coded with concatenation.

The constructions described above are not exhaustive but are the most common ones. We should also mention the permutation, renaming and erasure of fields. We described how to build records, but of course we also want to read them. There is actually a unique construction for this purpose.

$$
l e t i d x = x. i d;
$$

$$
l e t a g e x = x. a g e;
$$

Accessing some field  $a$  of a record  $x$  can be abstracted over  $x$ , but not over  $a$ : Labels are not values and there is no function which could take a label as argument and would access the field of some

fixed record corresponding to that label. Thus, we need one extraction function per label, as for id and age above. Then, they can be applied to different records of different types but all possessing the field to access. For instance,

age person, age driver;

They can also be passed to other functions, as in:

$$
l e t \quad c a r. j n f o \quad f i e l d = \text {f i e l d} \quad c a r;
$$

$$
c a r \_ i n f o _ {\text {a g e};}
$$

The testing function eq below should of course accept arguments of different types provided they have an id field of the same type.

$$
l e t e q x y = e q u a l x. i d y. i d;
$$

$$
e q \quad c a r \quad t r u c k;
$$

These examples were very simple. We will typecheck them below, but we will also meet more tricky ones.

# Related work

Luca Cardelli has always claimed that functional languages should have record operations. In 1986, when he designed Amber, his choice was to provide the language with records rather than polymorphism. Later, he introduced bounded quantification in the language FUN, which he extended to higher order bounded quantification in the language QUEST. Bounded quantification is an extension of ordinary quantification where quantified variables range in the subset of types that are all subtypes of the bound. The subtyping relation is a lattice on types. In this language, subtyping is essential for having some inheritance between records. A slight but significant improvement of bounded quantification has been made in  $\mathrm{[CCH^{+}89]}$  to better consider recursive objects; a more general but less tractable system was studied by Pavel Curtis [Cur87]. Today, the trend seems to be the simplification rather than the enrichment of existing systems [LC90, HP90, Car91]. For instance, an interesting goal was to remove the subtype relation in bounded quantification [HP90]. Records have also been formulated with explicit labeled conjunctive types in the language Forsythe [Rey88].

In contrast, records in implicitly typed languages have been less studied, and the proposed extensions of ML are still very restrictive. The language Amber [Car84, Car86] is monomorphic and inheritance is obtained by type inclusion. A major step toward combining records and type inference has been Wand's proposal [Wan87] where inheritance is obtained from ML generic polymorphism. Though type inference is incomplete for this system, it remains a reference, for it was the first concrete proposal for extending ML with records having inheritance. The year after, complete type inference algorithms were found for a strong restriction of this system [JM88, OB88]. The restriction only allows the strict extension of a record. Then, the author proposed a complete type inference algorithm for Wand's system [Rém89], but it was formalized only in the case of a finite set of labels (a previous solution given by Wand in 1988 did not admit principal types but complete sets of principal types, and was exponential in size in practice). Mitchell Wand revisited this approach and extended it with an "and" operation<sup>1</sup> but did not provide correctness proofs. The case of an infinite set of labels has been addressed in [Rém90], which we review in this article.

# 1 A simple solution when the set of labels is finite

Though the solution below will be made obsolete by the extension to a denumerable set of labels, we choose to present it first, since it is very simple and the extension will be based on the same ideas. It will also be a decent solution in cases where only few labels are needed. And it will emphasize a

method for getting more polymorphism in ML (in fact, we will not put more polymorphism in ML but we will make more use of it, sometimes in unexpected ways).

We will sketch the path from Wand's proposal to this solution, for it may be of some interest to describe the method which we think could be applied in other situations. As intuitions are rather subjective, and ours may not be yours, the section 1.1 can be skipped whenever it does not help.

# 1.1 The method

Records are partial functions from a set  $\mathcal{L}$  of labels to the set of values. We simplify the problem by considering only three labels  $a, b$  and  $c$ . Records can be represented in three field boxes, once labels have been ordered:

![](images/298010fa5d378a13b95a8affaa0129bc4bcc75c109aa52ef823e9a3e0bc981d9.jpg)


Defining a record is the same as filling some of the fields with values. For example, we will put the values 1 and true in the  $a$  and  $c$  fields respectively and leave the  $b$  field undefined.

![](images/ec4442f185114a11f00cca65bfe6ad18ae287e2749acee4a3baf963c5c7a7661.jpg)


Typechecking means forgetting some information about values. For instance, it does not distinguish two numbers but only remember them as being numbers. The structure of types usually reflects the structure of values, but with fewer details. It is thus natural to type record values with partial functions from labels  $(\mathcal{L})$  to types  $(\mathcal{T})$ , that is, elements of  $\mathcal{L} \longrightarrow \mathcal{T}$ . We first make record types total functions on labels using an explicitly undefined constant abs ("absent"):  $\mathcal{L} \longrightarrow \mathcal{T} \cup \{\text{abs}\}$ . In fact, we replace the union by the sum  $p r e(\mathcal{T}) + a b s$ . Finally, we decompose record types as follows:

$$
\mathcal {L} \longrightarrow [ 1, C a r d (\mathcal {L}) ] \longrightarrow p r e (\mathcal {T}) + a b s
$$

The first function is an ordering from  $\mathcal{L}$  to the segment  $[1, \operatorname{Card}(\mathcal{L})]$  and can be set once and for all. Thus record types can be represented only by the second component, which is a tuple of length  $\operatorname{Card}(\mathcal{L})$  of types in  $pre(\mathcal{T}) + abs$ . The previous example is typed by

![](images/5c377648772737399feb562c1942ccbb21e25c25a2ea635ac81171d3bb243a06.jpg)


A function  $\_a$  reading the  $a$  field accepts as argument any record having the  $a$  field defined with a value  $M$ , and returns  $M$ . The  $a$  field of the type of the argument must be  $pre(\tau)$  if  $\tau$  is the type of  $M$ . We do not care whether other fields are defined or not, so their types may be anything. We choose to represent them by variables  $\theta$  and  $\varepsilon$ . The result has type  $\alpha$ .

$$
\therefore a: \Pi (p r e (\alpha), \theta , \varepsilon) \rightarrow \alpha
$$

# 1.2 A formulation

We are given a collection of symbols  $\mathcal{C}$  with their arities  $(\mathcal{C}^n)_{n\in N}$  that contains at least an arrow symbol  $\rightarrow$  of arity 2, a unary symbol pre and a nullary symbol abs. We are also given two sorts type and field. The signature of a symbol is a sequence of sorts, written  $\iota$  for a nullary symbol and

$\iota_1 \ldots \otimes \iota_n \Rightarrow \iota$  for a symbol of arity  $n$ . The signature  $\mathcal{S}$  is defined by the following assertions (we write  $\mathcal{S} \vdash f:: \iota$  for  $(f, \iota) \in \mathcal{S}$ ):

$$
\begin{array}{l} \mathcal {S} \vdash p r e::: t y p e \Rightarrow f i e l d \\ \mathcal {S} \vdash a b s:: f i e l d \\ \mathcal {S} \vdash \Pi:: f i e l d ^ {\text {c a r d} (\mathcal {L})} \Rightarrow t y p e \\ \mathcal {S} \vdash f:: t y p e ^ {n} \Rightarrow t y p e \quad f \in \mathcal {C} ^ {n} \setminus \{p r e, a b s, \Pi \} \\ \end{array}
$$

The language of types is the free sorted algebra  $\mathcal{T}(\mathcal{S},\mathcal{V})$ . The extension of ML with sorted types is straightforward. We will not formalize it further, since this will be subsumed in the next section. The inference rules are the same as in ML though the language of types is sorted. The typing relation defined by these rules is still decidable and admits principal typings (see next section for a precise formulation). In this language, we assume the following primitive environment:

$$
\begin{array}{l} \{\}: \Pi (a b s, \dots a b s) \\ \begin{array}{c}\text {一 .} a: \Pi \left(\theta_ {1} \dots , p r e (\alpha), \dots \theta_ {l}\right)\rightarrow \alpha\end{array} \\ \left\{- \text {w i t h} a = - \right\}: \Pi \left(\theta_ {1}, \dots \theta_ {l}\right)\rightarrow \alpha \rightarrow \Pi \left(\theta_ {1} \dots , \operatorname {p r e} (\alpha), \dots \theta_ {l}\right) \\ \end{array}
$$

# Basic constants for IIML  $f_{in}$

The constant  $\{\}$  is the empty record. The  $.a$  constant reads the  $a$  field from its argument, we write  $r.a$  the application  $(\cdot .a)r$ . Similarly  $\{r$  with  $a = M\}$  extends the records  $r$  on label  $a$  with value  $M$ .

# 2 Extension to large records

Though the previous solution is simple, and perfect when there are only two or three labels involved, it is clearly no longer acceptable when the set of labels is getting larger. This is because the size of record types is proportional to the size of this set — even for the type of the null record, which has no field defined. When a local use of records is needed, labels may be fewer than ten and the solution works perfectly. But in large systems where some records are used globally, the number of labels will quickly be over one hundred.

In any program, the number of labels will always be finite, but with modular programming, the whole set of labels is not known at the beginning (though in this case, some of the labels may be local to a module and solved independently). In practice, it is thus interesting to reason on an "open", i.e. countable, set of labels. From a theoretical point of view, it is the only way to avoid reasoning outside of the formalism and show that any computation done in a system with a small set of labels would still be valid in a system with a larger set of labels, and that the typing in the latter case could be deduced from the typing in the former case. A better solution consists in working in a system where all potential labels are taken into account from the beginning.

In the first part, we will illustrate the discussion above and describe the intuitions. Then we formalize the solution in three steps. First we extend types with record types in a more general framework of sorted algebras; record types will be sorted types modulo equations. The next step describes an extension of ML with sorts and equations on types. Last, we apply the results to a special case, re-using the same encoding as for the finite case.

# 2.1 An intuitive approach

We first assume that there are only two labels  $a$  and  $b$ . Let  $r$  be the record  $\{a = 1; b = true\}$  and  $f$  the function that reads the  $a$  field. Assuming  $f$  has type  $\tau \to \tau'$  and  $r$  has type  $\sigma$ ,  $f$  can be applied to  $r$  if the two types  $\tau$  and  $\sigma$  are unifiable. In our example, we have

$$
\begin{array}{l} \tau = \Pi \left(a: p r e (\alpha); b: \theta_ {b}\right), \\ \sigma = \Pi (a: p r e (n u m); b: p r e (b o o l)), \\ \end{array}
$$

and  $\tau'$  is equal to  $\alpha$ . The unification of  $\tau$  and  $\sigma$  is done field by field and their most general unifier is:

$$
\left\{ \begin{array}{l} \alpha \mapsto n u m \\ \theta_ {b} \mapsto p r e (b o o l) \end{array} \right.
$$

If we had one more label  $c$ , the types  $\tau$  and  $\sigma$  would be

$$
\begin{array}{l} \tau = \Pi \left(a: p r e (\alpha) ; b: \theta_ {b} ; c: \theta_ {c}\right), \\ \sigma = \Pi (a: p r e (\text {n u m}); b: p r e (\text {b o o l}); c: a b s). \\ \end{array}
$$

and their most general unifier

$$
\left\{ \begin{array}{l} \alpha \mapsto n u m \\ \theta_ {b} \mapsto p r e (b o o l) \\ \theta_ {c} \mapsto a b s \end{array} \right.
$$

We can play again with one more label  $d$ . The types would be

$$
\begin{array}{l} \tau = \Pi \left(a: p r e (\alpha): b: \theta_ {b}: c: \theta_ {c}: d: \theta_ {d}\right), \\ \sigma = \Pi (a: p r e (\text {n u m}); b: p r e (\text {b o o l}); c: a b s; d: a b s). \\ \end{array}
$$

whose most general unifier is:

$$
\left\{ \begin{array}{l} \alpha \mapsto n u m \\ \theta_ {b} \mapsto p r e (b o o l) \\ \theta_ {c} \mapsto a b s \\ \theta_ {d} \mapsto a b s \end{array} \right.
$$

Since labels  $c$  and  $d$  appear neither in the expressions  $r$  nor in  $f$ , it is clear that fields  $c$  and  $d$  behave the same, and that all their type components in the types of  $f$  and  $r$  are equal up to renaming of variables (they are isomorphic types). So we can guess the component of the most general unifier on any new field  $\ell$  simply by taking a copy of its component on the  $c$  field or on the  $d$  field. Instead of writing types of all fields, we only need to write a template type for all fields whose types are isomorphic, in addition to the types of significant fields, that is those which are not isomorphic to the template.

$$
\begin{array}{l} \tau = \Pi \left(a: p r e (\alpha) ; b: \theta_ {b} ; \infty : \theta_ {\infty}\right), \\ \sigma = \Pi (a: p r e (\text {n u m}); b: p r e (\text {b o o l}); \infty : a b s). \\ \end{array}
$$

The expression  $\Pi ((\ell :\tau_{\ell})_{\ell \in I};\infty :\sigma_{\infty})$  should be read as

$$
\prod_ {\ell \in \mathcal {L}} \left(\ell : \left\{ \begin{array}{l l} \tau_ {\ell} & \text {i f} \ell \in I \\ \sigma_ {\ell} & \text {o t h e r w i s e , w h e r e} \sigma_ {\ell} \text {i s a c o p y o f} \sigma_ {\infty} \end{array} \right.\right)
$$

The most general unifier can be computed without developing this expression, thus allowing the set of labels to be infinite. We summarize the successive steps studied above in this figure:

<table><tr><td>Labels</td><td>a</td><td>b</td><td>c</td><td>d</td><td>∞</td></tr><tr><td>τ</td><td>pre(α)</td><td>θb</td><td>θc</td><td>θd</td><td>θ∞</td></tr><tr><td>σ</td><td>pre(num)</td><td>pre(bool)</td><td>abs</td><td>abs</td><td>abs</td></tr><tr><td>τ ∧ σ</td><td>pre(num)</td><td>pre(bool)</td><td>abs</td><td>abs</td><td>abs</td></tr></table>

This approach is so intuitive that it seems very simple. There is a difficulty though, due to the sharing between templates. Sometimes a field has to be extracted from its template, because it must be unified with a significant field.

The macroscopic operation that we need is the transformation of a template  $\tau$  into a copy  $\tau'$  (the type of the extracted field) and another copy  $\tau''$  (the new template). We regenerate the template during an extraction mainly because of sharing. But it is also intuitive that once a field has been extracted, the retained template should remember that, and thus it cannot be the same. In order to keep sharing, we must extract a field step by step, starting from the leaves.

For a template variable  $\alpha$ , the extraction consists in replacing that variable by two fresh variables  $\beta$  and  $\gamma$ , more precisely by the term  $\ell : \beta : \gamma$ . This is exactly the substitution

$$
\alpha \mapsto \ell : \beta ; \gamma
$$

For a term  $f(\alpha)$ , assuming that we have already extracted field  $\ell$  from  $\alpha$ , i.e. we have  $f(\ell : \beta ; \gamma)$ , we now want to replace it by  $\ell : f(\alpha) : f(\gamma)$ . The solution is simply to ask it to be true, that is, to assume the axiom

$$
f (\ell : \beta ; \gamma) = \ell : f (\alpha); f (\gamma)
$$

for every given symbol  $f$  but  $\Pi$ .

# 2.2 Extending a free algebra with a record algebra

The intuitions of previous sections are formalized by the algebra of record terms. The algebra of record terms is introduced for an arbitrary free algebra; record types are an instance. The record algebra was introduced in [Rém90] and revisited in [Rém92b]. We summarize it below but we recommend [Rém92b] for a more thorough presentation.

We are given a set of variables  $\mathcal{V}$  and a set of symbols  $\mathcal{C}$  with their arities  $(\mathcal{C}_n)_{n\in N}$ .

# Raw terms

We call unsorted record terms the terms of the free unsorted algebra  $\mathcal{T}'(\mathcal{D}',\mathcal{V})$  where  $\mathcal{D}'$  is the set of symbols composed of  $\mathcal{C}$  plus a unary symbol  $\Pi$  and a collection of projection symbols  $\{(\ell :\_ ;\_ )\mid$ $\ell \in \mathcal{L}\}$  of arity two. Projection symbols associate to the right, that is  $(a:\tau ;b:\sigma ;\tau ')$  stands for  $(a:\tau ;(b:\sigma ;\tau '))$

Example 1 The expressions

$$
\Pi \left(a: p r e (n u m); c: p r e (b o o l); a b s\right) \qquad \text {a n d} \qquad \Pi \left(a: p r e (b: n u m; n u m); a b s\right)
$$

are raw terms. In section 2.4 we will consider the former as a possible type for the record  $\{a = 1; c = true\}$  but we will not give a meaning to the latter. There are too many raw terms. The raw term  $\{a : \alpha ; \chi\} \to \chi$  must also be rejected since the template composed of the raw variable  $\chi$  should define the  $a$  field on the right but should not on the left. We define record terms using sorts to constrain their formation. Only a few of the raw terms will have associated record terms.

# Record terms

Let  $\mathcal{L}$  be a denumerable set of labels. Let  $\kappa$  be composed of a sort type, and a finite collection of sorts  $(row(L))$  where  $L$  range over finite subsets of labels. Let  $\mathcal{S}$  be the signature composed of the following symbols given with their sorts:

$$
\begin{array}{l} \mathcal {S} \vdash \Pi:: R o w (\emptyset) \Rightarrow T y p e \\ \mathcal {S} \vdash f ^ {K}: K ^ {n} \Rightarrow K \quad f \in \mathcal {C} ^ {n}, K \in \mathcal {K} \\ \mathcal {S} \vdash (\ell^ {L}: _ {-}; _ {-}):: T y p e \otimes R o w (L \cup \{\ell \}) \Rightarrow R o w (L) \quad \ell \in \mathcal {L}, L \in \mathcal {P} _ {f i n} (\mathcal {L} \setminus \{\ell \}) \\ \end{array}
$$

The superscripts are parts of symbols, so that the signature  $S$  is not overloaded, that is, every symbol has a unique signature. We write  $\mathcal{D}$  the set of symbols in  $S$ .

Example 2 The left term below is a record term. On the right, we drew a raw term with the same structure.

![](images/8558f307e6ea3035296d5d7c8efbab4fa24536cdbfcf173a0ecd9e4ed11e7a20.jpg)


![](images/2dc5bdcaad3f067c9a2158f9f1f47c4978f637476ede8e1cb13c8951b1a0406d.jpg)


# Script erasure

To any record term, we associate the raw term obtained by erasing all superscripts of symbols. Conversely, for any raw term  $\tau'$ , and any sort  $\iota$  there is at most one record term whose erasure is  $\tau'$ . Thus any record term  $\tau$  of sort  $\iota$  is completely defined by its erasure  $\tau'$  and the sort  $\iota$ . In the rest of the paper we will mostly use this convention. Moreover we usually drop the sort whenever it is implicit from context.

Example 3 The erasure of

$$
\Pi \left(a ^ {\emptyset}: f ^ {T y p e} (g ^ {T y p e}); \left(c ^ {\{a \}}: f ^ {T y p e} (\alpha); h ^ {R o w (\{a, c \})}\right)\right)
$$

is the raw term

$$
\Pi \left(a: f (g); c: f (\alpha); h\right)
$$

There is no record term whose erasure would be

$$
\Pi \left(a: f (b: g; \alpha); h\right)
$$

# Record algebra

The permutation and the extraction of fields in record terms will be obtained by equations, of left commutativity and distributivity respectively. Precisely, let  $E$  be the set of axioms

- Left commutativity. For any labels  $a$  and  $b$  and any finite subset of labels  $L$  that do not contain  $a$  and  $b$ ,

$$
a ^ {L}: \alpha ; \left(b ^ {L \cup \{a \}}: \beta ; \gamma\right) = b ^ {L}: \beta ; \left(a ^ {L \cup \{b \}}: \alpha ; \gamma\right)
$$

- Distributivity. For any symbol  $f$ , any label  $a$  and any finite subset of labels  $L$  that do not contain  $a$ ,

$$
f ^ {R o w (L)} (a ^ {L}: \alpha_ {1}; \beta_ {1}, \ldots a ^ {L}: \alpha_ {p}; \beta_ {p}) = a ^ {L}: f ^ {T y p e} (\alpha_ {1}, \ldots \alpha_ {p}); f ^ {R o w (L \cup \{a \})} (\beta_ {1}, \ldots \beta_ {p})
$$

With the raw notation the equations are written:

- Left commutativity. At any sort row  $(L)$ , where  $L$  does not contain labels  $a$  and  $b$ :

$$
a: \alpha ; (b: \beta ; \gamma) = b: \beta ; (a: \alpha ; \gamma)
$$

- Distributivity. At any sort  $\text{row}(L)$  where  $L$  does not contain label  $a$ , and for any symbol  $f$ :

$$
f (a: \alpha_ {1}; \beta_ {1}, \dots a: \alpha_ {p}; \beta_ {p}) = a: f (\alpha_ {1}, \dots \alpha_ {p}); f (\beta_ {1}, \dots \beta_ {p})
$$

All axioms are regular, that is, the set of variables of both sides of equations are always identical.

Example 4 In the term

$$
\Pi \left(a: p r e (n u m); c: p r e (b o o l); a b s\right)
$$

we can replace abs by  $b : \text{abs}$ ; abs using distributivity, and use left commutativity to end with the term:

$$
\Pi \left(a: p r e (n u m); b: a b s; c: p r e (b o o l); a b s\right)
$$

In the term

$$
\Pi \left(a: p r e (\alpha); \theta\right)
$$

we can substitute  $\theta$  by  $b:\theta_{b};c;\theta_{c};\varepsilon$  to get

$$
\Pi \left(a: p r e (\alpha) ; b: \theta_ {b} ; c: \theta_ {c}; \varepsilon\right)
$$

which can then be unified with the previous term field by field.

Definition 2 The algebra of record terms is the algebra  $\mathcal{T}(\mathcal{S},\mathcal{V})$  modulo the equational theory  $E$ , written  $\mathcal{T}(\mathcal{S},\mathcal{V}) / E$ .

Unification in the algebra of record terms has been studied in [Rém92b].

Theorem 1 Unification in the record algebra is decidable and unitary (every solvable unification problem has a principal unifier).

A unification algorithm is given in the appendix.

# Instances of record terms

The construction of the record algebra is parameterized by the initial set of symbols  $\mathcal{C}$ , from which the signature  $\mathcal{S}$  is deduced. The signature  $\mathcal{S}$  may also be restricted by a signature  $\mathcal{S}'$  that is compatible with the equations  $E$ , that is, a signature  $\mathcal{S}'$  such that for all axioms  $r$  and all sorts  $\iota$  of  $\mathcal{S}'$ ,

$$
\mathcal {S} ^ {\prime} \vdash r ^ {l}: \iota \iff \mathcal {S} ^ {\prime} \vdash r ^ {r}: \iota
$$

The algebra  $(\mathcal{T} / E)\upharpoonright S^{\prime}$  and  $(\mathcal{T}\upharpoonright \mathcal{S}^{\prime}) / (E\upharpoonright \mathcal{S}^{\prime})$  are then isomorphic, and consequently unification in  $(\mathcal{T}\upharpoonright \mathcal{S}^{\prime}) / (E\upharpoonright \mathcal{S}^{\prime})$  is decidable and unitary, and solved by the same algorithm as in  $\mathcal{T} / E$ . The  $S^{\prime}$ -record algebra is the restriction  $\mathcal{T}(S,\mathcal{V})\upharpoonright S^{\prime}$  of the record algebra by a compatible signature  $S^{\prime}$ .

We now consider a particular instance of record algebra, where fields are distinguished from arbitrary types, and structured as in section 1. The signature  $S'$  distinguishes a constant symbol abs and a unary symbol pre in  $\mathcal{C}$ , and is defined with two sorts type and field:

$$
\mathcal {S} ^ {\prime} \vdash \Pi :: f i e l d \Rightarrow t y p e
$$

$$
\mathcal {S} ^ {\prime} \vdash a b s ^ {\iota} :: f i e l d \quad \iota \in \mathcal {K}
$$

$$
\mathcal {S} ^ {\prime} \vdash p r e::: t y p e \Rightarrow f i e l d
$$

$$
\mathcal {S} ^ {\prime} \vdash f ^ {T y p e}:: t y p e ^ {n} \Rightarrow t y p e \quad f \in \mathcal {C} ^ {n} \setminus \{a b s, p r e, \Pi \}
$$

$$
\mathcal {S} ^ {\prime} \vdash (\ell^ {L}: -; -): f i e l d \otimes f i e l d \Rightarrow f i e l d \quad \ell \in \mathcal {L}, L \in \mathcal {P} _ {f i n} (\mathcal {L} \backslash \{\ell \})
$$

The signature  $S'$  is compatible with the equations of the record algebra. We call record types the  $S'$ -record algebra.

In fact, record types have a very simple structure. Terms of the sort  $\text{Row}(L)$  are either of depth 0 (reduced to a variable or a symbol) or are of the form  $(a : \tau ; \tau')$ . By induction, they are always of the form

$$
\left(a _ {1}: \tau_ {1}; \dots a _ {p}: \tau_ {p}; \sigma\right)
$$

where  $\sigma$  is either abs or a variable, including the case where  $p$  is zero and the term is reduced to  $\sigma$ . Record types are also generated by the pseudo-BNF grammar:

$$
\tau : := \alpha \mid \tau \rightarrow \tau \mid \Pi \rho^ {\emptyset} \quad \text {t y p e s}
$$

$$
\rho^ {L} := \chi^ {L} | a b s ^ {L} | a: \varphi ; \rho^ {L \cup \{a \}} \quad a \notin L \quad \text {r o w s}
$$

$$
\varphi : := \theta \mid a b s \mid p r e (\tau) \quad \text {f i e l d s}
$$

where  $\alpha, \beta, \gamma$  and  $\delta$  are type variables,  $\chi, \pi$  and  $\xi$  are row variables and  $\theta$  and  $\varepsilon$  are field variables. We prefer the algebraic approach which is more general.

# 2.3 Extending the types of ML with a sorted equational theory

In this section we consider a sorted regular theory  $\mathcal{T} / E$  for which unification is decidable and unitary. A regular theory is one whose left and right hand sides of axioms always have the same set of variables. For any term  $\tau$  of  $\mathcal{T} / E$  we write  $\mathcal{V}(\tau)$  for the set of its variables. We privilege a sort Type.

The addition of a sorted equational theory to the types of ML has been studied in [Rém90, Rém92a]. We recall here the main definitions and results. The language ML that we study is lambda-calculus extended with constants and a LET construct in order to mark some of the redexes, namely:

$$
M := \quad \text {T e r m s} \quad \mathrm {M}, \mathrm {N}
$$

$$
x \quad \text {V a r i a b l e} \quad \mathrm {x , y}
$$

$$
\begin{array}{c c} \mid c & \text {C o n s t a n t} \\ \hline \end{array}
$$

$$
\mid \lambda x. M \quad \text {A b s t r a c t i o n}
$$

$$
\mid M M \quad \text {A p p l i c a t i o n}
$$

$$
\mid \text {l e t} x = M \text {i n} M \quad \text {L e t b i n d i n g}
$$

The letter  $W$  ranges over finite set of variables. Type schemes are pairs noted  $\forall W \cdot \tau$  of a set of variables and a term  $\tau$ . The symbol  $\forall$  is treated as a binder and we consider type schemes equal modulo  $\alpha$ -conversion. The sort of a type scheme  $\forall W \cdot \tau$  is the sort of  $\tau$ . Contexts as sequences of assertions, that is, pairs of a term variable and a type. We write  $\mathcal{A}$  the set of contexts.

Every constant  $c$  comes with a closed type scheme  $\forall W \cdot \tau$ , written  $c: \forall W \cdot \tau$ . We write  $B$  the collection of all such constant assertions. We define a relation  $\vdash$  on  $\mathcal{A} \times \mathrm{ML} \times \mathcal{T}$  and parameterized by  $B$  as the smallest relation that satisfies the following rules:

$$
\frac {x : \forall W \cdot \tau \in A \qquad \mu : W \to \mathcal {T}}{A \vdash_ {S} x : \mu (\tau)} \left(\mathrm {V a r - I n s t}\right) \quad \frac {c : \forall W \cdot \tau \in B \qquad \mu : W \to \mathcal {T}}{A \vdash_ {S} c : \mu (\tau)} \left(\mathrm {C o n s t - I n s t}\right)
$$

$$
\frac {A [ x : \tau ] \vdash M : \sigma \quad \tau \in \mathcal {T}}{A \vdash \lambda x . M : \tau \rightarrow \sigma} (\text {F U N}) \quad \frac {A \vdash M : \sigma \rightarrow \tau \quad A \vdash N : \sigma}{A \vdash M N : \tau} (\text {A P P})
$$

$$
\begin{array}{c c} \underline {{A \vdash_ {S} M : \tau}} & A [ x: \forall W \cdot \tau ] \vdash_ {S} N: \sigma \qquad W \cap \mathcal {V} (A) = \emptyset \\ \hline & A \vdash_ {S} \text {l e t} x = M \text {i n} N: \sigma \end{array} (\mathrm {L E T - G E N})
$$

$$
\frac {A \vdash M : \sigma \quad \sigma = _ {E} \tau}{A \vdash M : \tau} \quad (\text {E Q U A L})
$$

They are the usual rules for ML except the rule EQUAL that is added since the equality on types is taken modulo the equations  $E$ .

A typing problem is a triple of  $\mathcal{A} \times \mathrm{ML} \times \mathcal{T}$  written  $A \triangleright M : \tau$ . The application of a substitution  $\mu$  to a typing problem  $A \triangleright M : \tau$  is the typing problem  $\mu(A) \triangleright M : \mu(\tau)$ , where substitution of a context is understood pointwise and only affects the type part of assertions. A solution of a typing problem  $A \triangleright M : \tau$  is a substitution  $\mu$  such that  $\mu(A) \vdash M : \mu(\tau)$ . It is principal if all other solutions are obtained by left composition with  $\mu$  of an arbitrary solution.

Theorem 2 (principal typings) If the sorted theory  $\mathcal{T} / E$  is regular and its unification is decidable and unitary, then the relation  $\vdash$  admits principal typings, that is, any solvable typing problem has a principal solution.

Moreover, there is an algorithm that given a typing problem computes a principal solution if one exists, or returns failure otherwise.

An algorithm can be obtained by replacing free unification by unification in the algebra of record terms in the core-ML type inference algorithm. A clever algorithm for type inference is described in [Rém92b].

# 2.4 Typechecking record operations

Using the two preceding results, we extend the types of ML with record types assuming given the following basic constants:

$$
\{\} : \Pi (a b s)
$$

$$
\therefore a: \Pi (a: p r e (\alpha); \theta) \rightarrow \alpha
$$

$$
\left\{\_ \text {w i t h} a = \_ \right\}: \Pi (a: \theta ; \chi) \rightarrow \alpha \rightarrow \Pi (a: p r e (\alpha); \chi)
$$

# Basic constants for IIML

There are countably many constants. We write  $\{a_1 = x_1; \ldots, a_n = x_n\}$  as syntactic sugar for:

$$
\left\{\left\{a _ {1} = x _ {1}; \dots a _ {n - 1} = x _ {n - 1} \right\} \text {w i t h} a _ {n}: x _ {n} \right\}
$$

We illustrate this system by examples in the next section.

The equational theory of record types is regular, and has a decidable and unitary unification. It follows from theorems 2 and 1 that the typing relation of this language admits principal typings, and has a decidable type inference algorithm.

# 3 Programming with records

We first show on simple examples how most of the constructions described in the introduction are typed, then we meet the limitations of this system. Some of them can be cured by slightly improving the encoding. Finally, we propose and discuss some further extensions.

# 3.1 Typing examples

A typechecking prototype has been implemented in the CAML language. It was used to automatically type all the examples presented here and preceded by the # character. In programs, type variables are printed according to their sort in  $S'$ . Letters  $\chi$ ,  $\pi$  and  $\xi$  are used for field variables and letters  $\alpha$ ,  $\beta$ , etc. are used for variables of the sort type. We start with simple examples and end with a short program.

Simple record values can be built as follows:

let car = {name = "Toyota"; age = "old"; id = 7866};

car:II (name:pre (string); id:pre (num); age:pre (string); abs)

let truck = {name = "Blazer"; id = 6587867567};

truck:II(name:pre (string);id:pre(num);abs)

let person = {name = "Tim"; age = 31; id = 5656787};

person:II (name:pre (string); id:pre (num); age:pre (num); abs)

Each field defined with a value of type  $\tau$  is significant and typed with  $pre(\tau)$ . Other fields are insignificant, and their types are gathered in the template abs. The record person can be extended with a new field vehicle:

let driver = {person with vehicle = car};

driver:

II (vehicle:pre (II (name:pre (string); id:pre (num); age:pre (string); abs));

name:pre (string); id:pre (num); age:pre (num); abs)

This is possible whether this field was previously undefined as above, or defined as in:

let truck_driver = {driver with vehicle = truck};

truck_driver:

II (vehicle:pre (II (name:pre (string); id:pre (num); abs)); name:pre (string);

id:pre (num); age:pre (num); abs)

The concatenation of two records is not provided by this system.

The sole construction for accessing fields is the "dot" operation.

let age  $x = x$  .age;

let id  $\times =$  x.id;

age:II (age:pre  $(\alpha)$  ；  $\chi)\rightarrow \alpha$

id:II (id:pre  $(\alpha)$  ；  $\chi$  ）→α

The accessed field must be defined with a value of type  $\alpha$ , so it has type pre  $(\alpha)$ , and other fields may or may not be defined; they are described by a template variable  $\chi$ . The returned value has type  $\alpha$ . As any value, age can be sent as an argument to another function:

let car_info field = field car;

car_info: (II (name:pre (string); id:pre (num); age:pre (string); abs)  $\rightarrow$ $\alpha$ )  $\rightarrow$ $\alpha$

car_info age;

it:string

The function equal below takes two records both possessing an id field of the same type, and possibly other fields. For simplicity of examples we assume given a polymorphic equality equal.

let eq x y = equal x.id y.id;

eq:II (id:pre  $(\alpha)$  .  $\chi$  ）  $\rightarrow$  II (id:pre  $(\alpha)$  .  $\pi$  )  $\rightarrow$  bool

#eq car truck;

it:bool

We will show more examples in section 3.3.

# 3.2 Limitations

There are two sorts of limitations, one is due to the encoding method, the other one results from ML generic polymorphism. The only source of polymorphism in record operations is generic polymorphism. A field defined with a value of type  $\tau$  in a record object is typed by  $pre(\tau)$ . Thus, once a field has been defined every function must see it defined. This forbids merging two records with different sets of defined fields. We will use the following function to shorten examples:

let choice  $x y =$  if true then x else y;

choice:  $\alpha \to \alpha \to \alpha$

Typechecking fails with:

choice car truck;

Typechecking error:collision between pre (string) and abs

The age field is undefined in truck but defined in car. This is really a weakness, since the program

(#(choice car truck).name;;

Typechecking error:collision between pre (string) and abs

which should be equivalent to the program

choice car.name truck.name;

it:string

may actually be useful. We will partially solve this problem in section 3.3. A natural generalization of the eq function defined above is to abstract over the field that is used for testing equality

let field_eq field  $\times y =$  equal (field x) (field y);

field_eq:  $(\alpha \rightarrow \beta)\rightarrow \alpha \rightarrow \alpha \rightarrow$  bool

It is enough general to test equality on other values than records. We get a function equivalent to the program eq defined in section 3.1 by applying field_eq to the function id.

let id_eq = field_eq id;

id_eq:II (id:pre  $(\alpha)$  .  $\chi)\rightarrow \Pi$  (id:pre  $(\alpha)$  .  $\chi)\rightarrow$  bool

id_eq car truck;

Typechecking error:collision between pre (string) and abs

The last example fails. This is not surprising since field is bound by a lambda in field_eq, and therefore its two instances have the same type, and so have both arguments x and y. In eq, the arguments x and y are independent since they are two instances of id. This is nothing else but ML generic polymorphism restriction. We emphasize that, as record polymorphism is entirely based on generic polymorphism, the restriction applies drastically to records.

# 3.3 Flexibility and Improvements

The method for typechecking records is very flexible: the operations on records have not been fixed at the beginning, but at the very end. They are parameters that can vary in many ways.

The easiest modification is changing the types of basic constants. For instance, asserting that  $\{-\text{with } a = -\}$  comes with type scheme:

$$
\left\{- \mathrm {w i t h} a = \mathrm {-} \right\}: \Pi \left(a: a b s; \chi\right)\rightarrow \alpha \rightarrow \Pi \left(a: p r e (\alpha); \chi\right)
$$

makes the extension of a record with a new field possible only if the field was previously undefined. This slight change gives exactly the strict version that appears in both attempts to solve Wand's system [JM88, OB88]. Weakening the type of this primitive may be interesting in some cases, because the strict construction may be easier to implement and more efficient.

We can freely change the types of primitives, provided we know how to implement them correctly. More generally, we can change the operations on records themselves. Since a defined field may not be dropped implicitly, it would be convenient to add a primitive removing explicitly a field from a record

$$
- \backslash a: \Pi \left(a: \theta ; \chi\right)\rightarrow \Pi \left(a: a b s; \chi\right),
$$

In fact, the constant  $\{-\text{with } a = -\}$  is not primitive. It should be replaced by the strict version:

$$
\{\_ w i t h! a = \_ \}: \Pi \left(a: a b s; \chi\right)\rightarrow \alpha \rightarrow \Pi \left(a: p r e (\alpha); \chi\right),
$$

and the  $\neg \backslash a$  constant, since the original version is the composition  $\{\neg \backslash a$  with  $!a = \neg\}$ . Our encoding also allows typing a function that renames fields

$$
r e n a m e ^ {a \leftarrow b}: \Pi \left(a: \theta ; b: \varepsilon ; \chi\right)\rightarrow \Pi \left(a: a b s; b: \theta ; \chi\right)
$$

The renamed field may be undefined. In the result, it is no longer accessible. A more primitive function would just exchange two fields

$$
\mathrm {e x c h a n g e} ^ {a \leftrightarrow b}: \Pi \left(a: \theta ; b: \varepsilon ; \chi\right)\rightarrow \Pi \left(a: \varepsilon ; b: \theta ; \chi\right)
$$

whether they are defined or not. Then the rename constant is simply the composition:

$$
(- \backslash a) \circ e x c h a n g e ^ {a \leftrightarrow b}
$$

More generally, the decidability of type inference does not depend on the specific signature of the pre and abs type symbols. The encoding of records can be revised. We are going to illustrate this by presenting another variant for type-checking records.

We suggested that a good type system should allow some polymorphism on records values themselves. We recall the example that failed to type

#choice car truck;

Typechecking error:collision between pre (string) and abs

because the age field was defined in car but undefined in truck. We would like the result to have a type with abs on this field to guarantee that it will not be accessed, but common, compatible fields should remain accessible. The idea is that a defined field should be seen as undefined whenever needed. From the point of view of types, this would require that a defined field with a value of type  $\tau$  should be typed with both pre  $(\tau)$  and abs.

Conjunctive types [Cop80] could possibly solve this problem, but they are undecidable in general. Another attempt is to make abs of arity 1 by replacing each use of abs by  $\text{abs}(\alpha)$  where  $\alpha$  is a generic variable. However, it is not possible to write  $\forall \theta \cdot \theta(\tau)$  where  $\theta$  ranges over abs and pre. The only possible solution is to make abs and pre constant symbols by introducing an infix field symbol "." and write abs.  $\alpha$  and pre.  $\alpha$  instead of abs  $(\alpha)$  and pre  $(\alpha)$ . It is now possible to write  $\forall \varepsilon \cdot (\varepsilon. \tau)$ . Formally, the signature  $S'$  is replaced by the signature  $S''$  given below, with a new sort flag:

$$
\mathcal {S} ^ {\prime \prime} \vdash \Pi :: f i e l d \Rightarrow t y p e
$$

$$
\mathcal {S} ^ {\prime \prime} \vdash a b s ^ {\iota}:: f l a g \quad \iota \in \mathcal {K}
$$

$$
\mathcal {S} ^ {\prime \prime} \vdash p r e ^ {\iota}:: f l a g \quad \iota \in \mathcal {K}
$$

$$
\mathcal {S} ^ {\prime \prime} \vdash . ^ {\iota}: f l a g \otimes t y p e \Rightarrow f i e l d \quad \iota \in \mathcal {K}
$$

$$
\mathcal {S} ^ {\prime \prime} \vdash f ^ {T y p e}: t y p e ^ {\varrho (f)} \Rightarrow t y p e \quad f \in \mathcal {C} \backslash \{a b s, p r e, \}.
$$

$$
\mathcal {S} ^ {\prime \prime} \vdash (\ell^ {L}: -; -): f i e l d \otimes f i e l d \Rightarrow f i e l d \quad \ell \in \mathcal {L}, L \in \mathcal {P} _ {f i n} (\mathcal {L} \setminus \{\ell \})
$$

Record constants now come with the following type schemes:

$$
\{\} : \Pi (a b s. \alpha)
$$

$$
\therefore a: \Pi (a: p r e. \alpha ; \chi) \rightarrow \alpha
$$

$$
\left\{- \text {w i t h} a = - \right\}: \Pi \left(a: \theta ; \chi\right)\rightarrow \alpha \rightarrow \Pi \left(a: \varepsilon . \alpha ; \chi\right)
$$

# Basic constants for IML'

It is easy to see that system  $\Pi \mathrm{ML}'$  is more general than system  $\Pi \mathrm{ML}$ ; any expression typeable in the system  $\Pi \mathrm{ML}$  is also typeable in the system  $\Pi \mathrm{ML}'$ : replacing in a proof all occurrences of abs

by abs.  $\alpha$  and all occurrence of pre  $(\tau)$  by pre.  $\tau$  (where  $\alpha$  does not appear in the proof), we obtain a correct proof in IIML'.

We show the types in the system  $\mathrm{IML}'$  of some of previous examples. Flag variables are written  $\varepsilon, \zeta$  and  $\eta$ . Building a record creates a polymorphic object, since all fields have a distinct flag variable:

let car = {name = "Toyota"; age = "old"; id = 7866};

car:II (name:ε.string; id:ζ num; age:η.string; abs.α)

let truck = {name = "Blazer"; id = 6587867567};

truck:II (name:ε:string; id:ζ num; abs.α)

Now these two records can be merged,

choice car truck;

it:II (name:ε:string; id:ζ num; age:abs:string; abs.α)

forgetting the age field in car. Note that if the presence of field age has been forgotten, its type has not: we always remember the types of values that have stayed in fields. Thus, the type system IML' rejects the program:

let person = {name = "Tim"; age = 31; id = 5656787};

person:II (name:ε(string; id:ζ num; age:η num; abs.α)

choice person car;

Typechecking error:collision between num and string

This is really a weakness of our system, since both records have common fields name and id, which might be tested on later. This example would be correct in the explicitly typed language QUEST [Car89]. If we add a new collection of primitives

$$
- \backslash a: \Pi \left(a: \theta ; \chi\right)\rightarrow \Pi \left(a: a b s. \alpha ; \chi\right),
$$

then we can turn around the failure above by explicitly forgetting label age in at least one record

choice (car \ age) person;

it:II (age:abs.num; name:e(string; id: $\zeta$ .num; abs. $\alpha$ )

choice car (person \ age);

it:II (age: abs(string; name:ε:string; id:ζ num; abs.α)

choice(car\age)(person\age);

it:II (age:abs.α; name:ε(string; id:ζ-num; abs.β)

A more realistic example illustrates the ability to add annotations on data structures and type the presence of these annotations. The example is run into the system IIML', where we assume given an infix addition  $^+$  typed with num  $\rightarrow$  num  $\rightarrow$  num.

type tree  $(\varepsilon) =$  Leaf of num

#

# annot:ε.num; abs.unit}

#

New constructors declared:

Node:II (left:pre.tree  $(\varepsilon)$  right:pre.tree  $(\varepsilon)$  ;annot:  $\varepsilon$  .num; abs(unit)  $\rightarrow$  tree  $(\varepsilon)$

Leaf: num → tree (ε)

The variable  $\varepsilon$  indicates the presence of the annotation annot. For instance this annotation is absent in the structure

```txt
let winter = 'Node {left = 'Leaf 1; right = 'Leaf 2 }; winter:tree (abs)
```

The following function annotates a structure.

```txt
let rec annotation =  
function  
Leaf n  $\rightarrow$  'Leaf n, n  
# | Node {left = r; right = s}  $\rightarrow$   
let (r,p) = annotation r in  
# | let (s,q) = annotation s in  
# | 'Node {left = r; right = s; annot = p+q}, p+q;  
annotation: tree ( $\varepsilon$ )  $\rightarrow$  tree ( $\zeta$ )* num  
# let annotate x = match annotation x with y,  $\rightarrow$  y;  
annote: tree ( $\varepsilon$ )  $\rightarrow$  tree ( $\zeta$ )
```

We use it to annotate the structure winter.

```txt
let spring  $=$  annotate winter;   
spring:tree  $(\varepsilon)$
```

We will read a structure with the following function.

```javascript
let read = function 'Leaf n → n | 'Node r → rannot;;  
read:tree(pre) → num
```

It can be applied to the value spring, but not to the empty structure winter.

```batch
read winter; #read spring;  
Typechecking error:collision between pre and abs it:num
```

But the following function may be applied to both winter and spring:

```txt
let rec left = #left winter;  
# function it: num  
# 'Leaf n → n  
# | 'Node r → left (r.left); #left spring;  
left: tree  $(\varepsilon)\rightarrow$  num it: num
```

# 3.4 Extensions

In this section we describe two possible extensions. The two of them have been implemented in a prototype, but not completely formalized yet.

One important motivation for having records was the encoding of some object oriented features into them. But the usual encoding uses recursive types [Car84, Wan89]. An extension of ML with variant types is easy once we have record types, following the idea of [Rém89], but the extension is interesting essentially if recursive types are allowed.

Thus it would be necessary to extend the results presented here with recursive types. Unification on rational trees without equations is well understood [Hue76, MM82]. In the case of a finite set of labels, the extension of theorem 2 to rational trees is easy. The infinite case uses an equational theory, and unification in the extension of first order equational theory to rational trees has no decidable and unitary algorithm in general, even when the original theory has one. But the simplicity of the record theory lets us conjecture that it can be extended with regular trees.

Another extension, which was sketched in [Rém89], partially solves the restrictions due to ML polymorphism. Because subtyping polymorphism goes through lambda abstractions, it could be used to type some of the examples that were wrongly rejected. ML type inference with subtyping

polymorphism has been first studied by Mitchell in [Mit84] and later by Mishra and Fuh [FM88, FM89]. The LET-case has only been treated in [Jat89]. But as for recursive types, subtyping has never been studied in the presence of an equational theory. Although the general case of merging subtyping with an equational theory is certainly difficult, we believe that subtyping is compatible with the axioms of the algebra of record types. We discuss below the extension with subtyping in the finite case only. The extension in the infinite case would be similar, but it would rely on the previous conjecture.

It is straightforward to extend the results of [FM89] to deal with sorted types. It is thus possible to embed the language  $\mathrm{IML}_{fin}$  into a language with subtypes  $\mathrm{IML}_{\subset}$ . In fact, we use the language  $\mathrm{IML}_{\subset}^{\prime}$  that has the signature of the language  $\mathrm{IML}^{\prime}$  for a technical reason that will appear later. The subtype relation we need is closed structural subtyping. Closed² structural subtyping is defined relatively to a set of atomic coercions as the smallest  $E$ -reflexive (i.e. that contains  $=_{E}$ ) and transitive relation  $\subset$  that contains the atomic coercions and that satisfies the following rules [FM89]:

$$
\frac {\sigma \subset \tau \qquad \tau^ {\prime} \subset \sigma^ {\prime}}{\tau \rightarrow \tau^ {\prime} \subset \sigma \rightarrow \sigma^ {\prime}}
$$

$$
\frac {\tau_ {1} \subset \sigma_ {1} , \dots \tau_ {p} \subset \sigma_ {p}}{f (\tau_ {1} , \dots \tau_ {p}) \subset f (\sigma_ {1} , \dots \sigma_ {p})} \quad f \in \mathcal {C} \setminus \{\rightarrow \}
$$

In  $\Pi \mathrm{ML}_{\subset}^{\prime}$ , we consider the unique atomic coercion  $pre \subset abs$ . It says that if a field is defined, it can also be view as undefined. We assign the following types to constants:

$$
\{\} : \Pi (a b s. \alpha_ {1}, \dots a b s. \alpha_ {l})
$$

$$
\therefore a: \Pi \left(\theta_ {1} \dots , p r e. \alpha \dots \theta_ {l}\right)\rightarrow \alpha
$$

$$
\{- \text {w i t h} a = - \}: \Pi \left(\theta_ {1}, \dots \theta_ {l}\right)\rightarrow \alpha \rightarrow \Pi \left(\theta_ {1} \dots , p r e. \alpha , \dots \theta_ {l}\right)
$$

# Basic constants for  $\mathrm{IIML}_{\mathbb{C}}^{\prime}$

If the types look the same as without subtyping, they are taken modulo subtyping, and are thus more polymorphic. In this system, the program

let id_eq = field_id;

is typed with:

$$
\operatorname {i d} _ {-} \operatorname {e q}: \left\{\operatorname {i d}: \operatorname {p r e}. \alpha ; \chi \right\}\rightarrow \left\{\operatorname {i d}: \operatorname {p r e}. \alpha ; \chi \right\}\rightarrow \text {b o o l}
$$

This allows the application modulo subtyping id_eq car truck. The field age is implicitly forgotten in truck by the inclusion rules. However, we still fail with the example choice person car. The presence of fields can be forgotten, yet their types cannot, and there is a mismatch between num and string in the old field of both arguments. A solution to this failure is to use the signature  $S'$  instead of  $S''$ . However the inclusion relation now contains the assertion  $pre(\alpha) \subset abs$  which is not atomic. Such coercions do not define a structural subtyping relation. Type inference with non-structural inclusion has not been studied successfully yet and it is surely difficult (the difficulty is emphasized in [Rém89]). The type of primitives for records would be the same as in the system IML $_{fin}$ , but modulo the non-structural subtyping relation.

# Conclusion

We have described a simple, flexible and efficient solution for extending ML with operations on records allowing some sort of inheritance. The solution uses an extension of ML with a sorted

$$
\text {I f} \alpha \in \mathcal {V} (\tau) \wedge \tau \in e \backslash \mathcal {V}, \quad \frac {U \wedge (\alpha \mapsto \sigma) (e)}{U \wedge \exists \alpha \cdot (e \wedge \alpha = \sigma)} \quad \left(\text {G E N E R A L I Z E}\right)
$$

$$
\begin{array}{c c}\frac {U \wedge a : \tau ; \tau^ {\prime} = a b s = e}{\sim_ {\rightarrow}}&\frac {U \wedge a : \alpha ; \alpha^ {\prime} = b : \beta ; \beta^ {\prime} = e}{\sim_ {\rightarrow}}\\U \wedge \bigwedge \left\{\begin{array}{l}a b s = e\\\tau = a b s\\\tau^ {\prime} = a b s\end{array}\right.&U \wedge \exists \gamma \cdot \bigwedge \left\{\begin{array}{l}b: \beta ; \beta^ {\prime} = e\\\alpha^ {\prime} = b: \beta ; \gamma\\\beta^ {\prime} = a: \alpha ; \gamma\end{array}\right.\end{array}(\mathrm {M U T A T E})
$$

$$
\frac {U \wedge f (\tau_ {1} , \dots \tau_ {p}) = f (\alpha_ {1} , \dots \alpha_ {p}) = e}{U \wedge \bigwedge \left\{ \begin{array}{l} f (\alpha_ {1}, \dots \alpha_ {p}) = e \\ \tau_ {i} = \alpha_ {i}, \qquad i \in [ 1, p ] \end{array} \right.} \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad \qquad (D E C O M P O S E)
$$

$$
\begin{array}{c} \frac {U \wedge \alpha = e \wedge \alpha = \stackrel {\sim} {e ^ {\prime}}}{U \wedge \alpha = e = e ^ {\prime}} \end{array} \quad (\mathrm {F U S E})
$$

Figure 1: Rewriting rules for record-type unification

equational theory over types. An immediate improvement is to allow recursive types needed in many applications of records.

The main limitation of our solution is ML polymorphism. In many cases, the problem can be solved by inserting retyping functions. We also propose structural subtyping as a more systematic solution. But it is not clear yet whether we would want such an extension, for it might not be worth the extra cost in type inference.

# Acknowledgments

I am grateful for interesting discussions with Peter Buneman, Val Breazu-Tannen and Carl Gunter, and particularly thankful to Xavier Leroy and Benjamin Pierce whose comments on the presentation of this article were very helpful.

# A Unification on record types

The algorithm is an adaptation of the one given in [Rém92b], which we recommend for a more thorough presentation. It is described by transformations on unificands that keep unchanged the set of solutions. Multi-equations are multi-sets of terms, written  $\tau_{1} = \ldots \tau_{p}$ , and unificands are systems of multi-equations, that is, multi-sets of multi-equations, with existential quantifiers. Systems of multi-equations are written  $U$ . The union of systems of multi-equations (as multi-sets) is written  $U \wedge U'$  and  $\exists \alpha \cdot U$  is the existential quantification of  $\alpha$  in  $U$ . Indeed,  $\exists$  acts as a binder and systems of multi-equations are taken modulo  $\alpha$ -conversion, permutation of consecutive binders, and  $\exists \alpha \cdot U$  is assumed equal to  $U$  whenever  $\alpha$  is not free in  $U$ . We also consider both unificands  $U \wedge \exists \alpha \cdot U'$  and  $\exists \alpha \cdot U \wedge U'$  equal whenever  $\alpha$  is not in  $U$ . Any unificand can be written  $\exists W \cdot U$  where  $W$  is a set of variables, and  $U$  does not contain any existential.

The algorithm reduces a unificand into a solved unificand in three steps, or fails. The first step is described by rewriting rules of figure 1. Rewriting always terminates. A unificand that cannot be transformed anymore is said completely decomposed if no multi-equation has more than one non-variable term, and the algorithm pursues with the occur check while instantiating the equations

by partial solutions as described below, otherwise the unificand is not solvable and the algorithm fails.

We say that a multi-equation  $e'$  is inner a multi-equation  $e$  if there is at least a variable term of  $e'$  that appears in a non-variable term of  $e$ , and we write  $e' \leqslant e$ . We also write  $U' \neq U$  for

$$
\forall e ^ {\prime} \in U ^ {\prime}, \forall e \in U, e ^ {\prime} \neq e
$$

The system  $U$  is independent if  $U \neq U$ .

The second step applies the rule

$$
\text {I f} e \wedge U \neq e, \quad \frac {e \wedge U}{e \wedge \hat {e} (U)} \quad \left(\text {R E P L A C E}\right)
$$

until all possible candidates  $e$  have fired the rule once, where  $\hat{e}$  is the trivial solution of  $e$  that sends all variable terms to the non-variable term if it exists, or to any (but fixed) variable term otherwise. If the resulting system  $U$  is independent (i.e.  $U \neq U$ ), then the algorithm pursues as described below; otherwise it fails and  $U$  is not solvable.

Last step eliminates useless existential quantifiers and singleton multi-equations by repeated application of the rules:

$$
\text {I f} \alpha \notin e \wedge U, \quad \frac {\exists \alpha \cdot (\alpha = e \wedge U)}{e \wedge U} \stackrel {\sim} {\rightarrow} \quad \frac {\{\tau \} \wedge U}{U} \stackrel {\sim} {\rightarrow} \quad \left(\text {G A R B A G E}\right)
$$

This always succeeds, with a system  $\exists W \cdot U$  that is still independent. A principal solution of the system is  $\hat{U}$ , that is, the composition, in any order, of the trivial solutions of its multi-equations. It is defined up to a renaming of variables in  $W$ . The soundness and correctness of this algorithm is described in [Rém92b].

The REPLACE step is actually not necessary, and a principal solution can be directly read from a completely decomposed form provided the transitive closure of the inner relation on the system is acyclic (see [Rém92b] for details).

With the signature  $\mathcal{S}''$  the only change to the algorithm is the addition of the mutation rules:

$$
\frac {a : \tau ; \tau^ {\prime} = p r e = e}{\bigwedge \left\{ \begin{array}{l} p r e = e \\ \tau = p r e \\ \tau^ {\prime} = p r e \end{array} \right.}
$$

$$
\begin{array}{c}a:\alpha   ;  \beta = \gamma_{1}. \gamma_{2} = e\\ \hline \\ \exists \alpha_{1}\alpha_{2}\beta_{1}\beta_{2}\cdot \bigwedge \left\{ \begin{array}{l}\gamma_{1}. \gamma_{2} = e\\ \alpha = \alpha_{1}. \alpha_{2}\\ \beta = \beta_{1}. \beta_{2}\\ \gamma_{1} = a: \alpha_{1}. \beta_{1}\\ \gamma_{2} = a: \alpha_{2}. \beta_{2} \end{array} \right. \end{array}
$$

Note that in the first mutation rule, all occurrences of pre in the conclusion (the right hand side) of the rewriting rule have different sorts and the three equations could not be merged into a multi-equation. They surely will not be merged later since a common constant cannot fire fusion of two equations (only a variable can). As all rules are well sorted, rewriting keeps unificands well sorted.

# References



[Ber88] Bernard Berthomieu. Une implantation de CCS. Technical Report 88367, LAAS, 7, Avenue du Colonel Roche, 31077 Toulouse, France, décembre 1988.





[Car84] Luca Cardelli. A semantics of multiple inheritance. In Semantics of Data Types, volume 173 of Lecture Notes in Computer Science, pages 51-68. Springer Verlag, 1984. Also in Information and Computation, 1988.





[Car86] Luca Cardelli. Amber. In Combinators and Functional Programming Languages, volume 242 of Lecture Notes in Computer Science, pages 21-47. Springer Verlag, 1986. Proceedings of the 13th Summer School of the LITP.





[Car89] Luca Cardelli. Typefull programming. In IFIP advanced seminar on Formal Methods in Programming Language Semantics, Lecture Notes in Computer Science. Springer Verlag, 1989.





[Car91] Luca Cardelli. Extensible records in a pure calculus of subtyping. Private Communication, 1991.





$\left[\mathrm{CCH}^{+}89\right]$  Peter Canning, William Cook, Walter Hill, Walter Olthoff, and John C. Mitchell. F- Bounded polymorphism for object oriented programming. In The Fourth International Conference on Functional Programming Languages and Computer Architecture, 1989.





[CH89] Guy Cousineau and Gérard Huet. The CAML Primer. INRIA-Rocquencourt, BP 105, F-78 153 Le Chesnay Cedex, France, 1989.





[CM89] Luca Cardelli and John C. Mitchell. Operations on records. In Fifth International Conference on Mathematical Foundations of Programming Semantics, 1989.





[Cop80] Mario Coppo. An extended polymorphic type system for applicative languages. In MFCS '80, volume 88 of Lecture Notes in Computer Science, pages 194-204. Springer Verlag, 1980.





[Cur87] Pavel Curtis. Constrained Quantification in Polymorphic Type Analysis. PhD thesis, Cornell, 1987.





[FM88] You-Chin Fuh and Prateek Mishra. Type inference with subtypes. In *ESOP '88*, volume 300 of Lecture Notes in Computer Science, pages 94-114. Springer Verlag, 1988.





[FM89] You-Chin Fuh and Prateek Mishra. Polymorphic subtype inference: Closing the theory-practice gap. In TAPSOFT'89, 1989.





[HMT91] Robert Harper, Robin Milner, and Mads Tofte. The definition of Standard ML. The MIT Press, 1991.





[HP90] Robert W. Harper and Benjamin C. Pierce. Extensible records without subsumption. Technical Report CMU-CS-90-102, Carnegie Mellon University, Pittsburg, Pennsylvania, February 1990.





[Hue76] Gérard Huet. Résolution d'équations dans les langages d'ordre 1,2,...,ω. Thèse de doctorat d'état, Université Paris 7, 1976.





[Lat89] Lalita A. Jategaonkar. ML with extended pattern matching and subtypes. Master's thesis, MIT, 545 Technology Square, Cambridge, MA 02139, August 89.





[JM88] Lalita A. Jategaonkar and John C. Mitchell. ML with extended pattern matching and subtypes. In Proceedings of the 1988 Conference on LISP and Functional Programming, 1988.





[LC90] Giuseppe Longo and Luca Cardelli. A semantic basis for QUEST. In Proceedings of the 1990 Conference on LISP and Functional Programming, 1990.





[Mil80] Robin Milner. A calculus of communicating systems. In Lecture Notes in Computer Science, volume 230. Springer Verlag, 1980.





[Mit84] John C. Mitchell. Coercion and type inference. In Eleventh Annual Symposium on Principles Of Programming Languages, 1984.





[MM82] Alberto Martelli and Ugo Montanari. An efficient unification algorithm. ACM Transactions on Programming Languages and Systems, 4(2):258-282, 1982.





[OB88] Atsushi Ohori and Peter Buneman. Type inference in a database language. In ACM Conference on LISP and Functional Programming, pages 174-183, 1988.





[Rém89] Didier Rémy. Records and variants as a natural extension of ML. In Sixteenth Annual Symposium on Principles Of Programming Languages, 1989.





[Rém90] Didier Rémy. Algèbres Touffues. Application au Typage Polymorphe des Objects Enregistements dans les Langages Fonctionnels. Thèse de doctorat, Université de Paris 7, 1990.





[Rém92a] Didier Rémy. Extending ML type system with a sorted equational theory. Research report 1766, INRIA-Rocquencourt, BP 105, F-78 153 Le Chesnay Cedex, 1992.





[Rem92b] Didier Rémy. Syntactic theories and the algebra of record terms. Research report 1869, INRIA-Rocquencourt, BP 105, F-78 153 Le Chesnay Cedex, 1992.





[Rey88] John C. Reynolds. Preliminary design of the programming language Forsythe. Technical Report CMU-CS-88-159, Carnegie Mellon University, Pittsburgh, Pennsylvania, June 1988.





[Wan87] Mitchell Wand. Complete type inference for simple objects. In Second Symposium on Logic In Computer Science, 1987.





[Wan89] Mitchell Wand. Type inference for record concatenation and multiple inheritance. In Fourth Annual Symposium on Logic in Computer Science, pages 92-97, 1989.





[Wei89] Pierre Weis. The CAML Reference Manual. BP 105, F-78 153 Le Chesnay Cedex, France, 1989.

