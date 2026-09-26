import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/**
 * The privacy notice. Keep it true: whenever the app starts storing,
 * sharing or keeping something differently, update both languages below and
 * POLICY_VERSION (here and in apps/server/src/lib/legal.ts). See CLAUDE.md.
 */
export const POLICY_VERSION = "2026-09-26.2";
const UPDATED = { fr: "26 septembre 2026", en: "26 September 2026" };

type Legal = { policyVersion: string; controller: string | null; contact: string | null };
type Lang = "fr" | "en";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/60 text-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const code = (s: string) => <code className="rounded bg-muted px-1 text-foreground">{s}</code>;

export function PrivacyPage() {
  const [lang, setLang] = useState<Lang>(() => (navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en"));
  const { data } = useQuery({ queryKey: ["legal"], queryFn: () => api.get<Legal>("/legal") });
  const controller = data?.controller;
  const contact = data?.contact;
  const who =
    lang === "fr"
      ? controller
        ? <><strong>{controller}</strong>, qui exploite cette instance de The Last Radio.</>
        : <>l'<strong>administrateur de cette instance</strong> de The Last Radio (coordonnées non renseignées : demandez-les via « Envoyer un retour »).</>
      : controller
        ? <><strong>{controller}</strong>, who runs this instance of The Last Radio.</>
        : <>the <strong>administrator of this instance</strong> of The Last Radio (contact details not set yet: ask through "Send feedback").</>;
  const reach = contact ? <a className="text-foreground underline" href={`mailto:${contact}`}>{contact}</a> : null;

  return (
    <article className="mx-auto max-w-3xl space-y-8 pb-12">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {lang === "fr" ? "Confidentialité et cookies" : "Privacy and cookies"}
          </h1>
          <div className="flex gap-1" role="radiogroup" aria-label="Language">
            {(["fr", "en"] as const).map((l) => (
              <Button key={l} size="sm" role="radio" aria-checked={lang === l} variant={lang === l ? "secondary" : "ghost"} onClick={() => setLang(l)}>
                {l === "fr" ? "Français" : "English"}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === "fr" ? "Dernière mise à jour" : "Last updated"} : <strong className="text-foreground">{UPDATED[lang]}</strong> (version {POLICY_VERSION}).{" "}
          {lang === "fr"
            ? "Cette notice applique le Règlement général sur la protection des données (RGPD) et la loi « Informatique et Libertés » du 6 janvier 1978 modifiée. La version française fait foi."
            : "This notice applies the General Data Protection Regulation (GDPR) and the French Data Protection Act (loi « Informatique et Libertés ») of 6 January 1978 as amended. The French version prevails."}
        </p>
      </header>

      {lang === "fr" ? (
        <>
          <Section title="1. Qui est responsable de vos données ?">
            <p>Le responsable du traitement est {who}{reach && <> Contact : {reach}.</>}</p>
          </Section>

          <Section title="2. Ce que nous conservons, pourquoi et combien de temps">
            <Table
              head={["Données", "Pourquoi", "Base légale", "Durée"]}
              rows={[
                [<><strong>Compte</strong> : e-mail, nom affiché, mot de passe (jamais en clair : empreinte argon2id salée), rôle, thème, dates de création</>, "Vous identifier et faire fonctionner votre compte", "Exécution du service (art. 6.1.b RGPD)", "Jusqu'à la suppression du compte"],
                [<><strong>Photo de profil</strong> (facultative), ré-encodée en 256×256, métadonnées (EXIF, GPS) supprimées</>, "Vous représenter auprès des autres auditeurs", "Exécution du service", "Jusqu'à ce que vous la retiriez ou supprimiez le compte"],
                [<><strong>Session</strong> : cookie {code("lr_session")} (jeton aléatoire, conservé uniquement sous forme d'empreinte)</>, "Vous garder connecté", "Exécution du service", "30 jours, ou jusqu'à la déconnexion"],
                [<><strong>Chansons ajoutées</strong> (lien, titre, station, dates) et <strong>votes pour passer</strong> une chanson</>, "Faire tourner la file, l'historique, les statistiques des stations et les choix d'Alfred", "Exécution du service ; intérêt légitime (art. 6.1.f)", "Tant que la station existe ; anonymisées à la suppression de votre compte"],
                [<><strong>Retours</strong> envoyés (texte, type, statut lu/archivé)</>, "Améliorer la radio", "Intérêt légitime", "Jusqu'à leur suppression ou celle de votre compte"],
                [<><strong>Accès API et assistants IA</strong> : nom et portée des clés, applications connectées, dates d'usage ; jetons conservés uniquement sous forme d'empreinte</>, "Permettre à vos outils d'agir pour vous", "Exécution du service", "Jusqu'à révocation ; jetons d'accès 1 h, de rafraîchissement 60 jours, codes 10 min"],
                [<><strong>Confirmation de votre e-mail</strong> : date de confirmation ; liens à usage unique (conservés uniquement sous forme d'empreinte)</>, "Prouver que l'adresse est la vôtre, pour rejoindre les stations privées ouvertes à votre domaine", "Exécution du service", "Liens : 24 h ; date : durée du compte"],
                [<><strong>Stations privées</strong> : les stations auxquelles un administrateur vous a ajouté</>, "Vous donner accès à ces stations", "Exécution du service", "Jusqu'à ce qu'un administrateur vous retire, ou la suppression du compte"],
                [<><strong>Confirmation de cette notice</strong> (version, date)</>, "Pouvoir montrer que vous avez été informé", "Intérêt légitime", "Durée du compte"],
                [<><strong>Adresse IP</strong> : en mémoire pour limiter les abus et compter les auditeurs ; dans les journaux techniques du serveur web (IP, date, page demandée)</>, "Sécurité, prévention des abus", "Intérêt légitime", "Mémoire : 45 s à 24 h, effacée au redémarrage ; journaux : rotation automatique (~30 Mo par service, quelques semaines au plus)"],
              ]}
            />
          </Section>

          <Section title="3. Ce que nous ne faisons pas">
            <ul className="list-disc space-y-1 pl-5">
              <li>Aucune publicité, aucune mesure d'audience, aucun traceur ni cookie tiers.</li>
              <li>Aucune revente ni location de données, aucun profilage.</li>
              <li>Pas d'historique d'écoute individuel : nous comptons les auditeurs en direct, sans conserver qui a écouté quoi.</li>
              <li>Aucune donnée de paiement, aucune géolocalisation. Les photos perdent leurs métadonnées dès l'envoi.</li>
            </ul>
          </Section>

          <Section title="4. Cookies et stockage dans votre navigateur">
            <Table
              head={["Nom", "Type", "Rôle", "Durée"]}
              rows={[
                [code("lr_session"), "Cookie (HttpOnly)", "Connexion : strictement nécessaire", "30 jours"],
                [code("lr_theme"), "Stockage local", "Thème choisi (Night, Light, Vintage)", "Jusqu'à effacement"],
                [code("lr_volume"), "Stockage local", "Volume du lecteur", "Jusqu'à effacement"],
                [code("lr_search_source"), "Stockage local", "Service de recherche choisi", "Jusqu'à effacement"],
                [code("lr_listener"), "Stockage local", "Identifiant aléatoire pour compter les auditeurs", "Jusqu'à effacement"],
              ]}
            />
            <p>
              Ces éléments sont strictement nécessaires au service ou servent une fonction que vous demandez : ils sont
              exemptés de consentement (article 82 de la loi Informatique et Libertés, lignes directrices de la CNIL).
              C'est pourquoi il n'y a pas de bandeau cookies : nous vous demandons seulement de prendre connaissance de
              cette notice à l'inscription, puis à chaque mise à jour.
            </p>
          </Section>

          <Section title="5. Qui voit vos données">
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Les autres auditeurs</strong> voient votre nom affiché, votre photo et les chansons que vous ajoutez.</li>
              <li><strong>Les administrateurs</strong> de la radio voient aussi votre e-mail et vos retours.</li>
              <li><strong>Envoi d'e-mails</strong> : pour vous envoyer le lien de confirmation, votre adresse est transmise au service d'envoi (SMTP) choisi par le responsable.</li>
              <li><strong>Services musicaux</strong> : notre serveur récupère les chansons auprès de YouTube, SoundCloud, Bandcamp, etc. ; votre adresse IP ne leur est pas transmise. En revanche, les <strong>vignettes</strong> des chansons sont chargées par votre navigateur directement depuis leurs serveurs (Google/YouTube, SoundCloud), qui reçoivent alors votre adresse IP et peuvent être situés hors de l'Union européenne.</li>
              <li><strong>Assistants IA</strong> que vous connectez : ce que nos outils leur renvoient est traité par leur éditeur selon sa propre politique.</li>
            </ul>
          </Section>

          <Section title="6. Hébergement et sécurité">
            <p>
              The Last Radio est auto-hébergé par le responsable du traitement ; nous ne transférons pas vos données hors
              de l'Union européenne, hormis le cas des vignettes ci-dessus. Mots de passe hachés avec argon2id et sel,
              jetons hachés (SHA-256), limitation des tentatives, protections contre les requêtes intersites et vers des
              adresses internes, actions d'administration réservées au site.
            </p>
          </Section>

          <Section title="7. Vos droits">
            <p>
              Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de
              portabilité, ainsi que du droit de définir des directives relatives au sort de vos données après votre
              décès (article 85 de la loi Informatique et Libertés). Directement depuis « Modifier le profil » :
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Télécharger mes données</strong> : accès et portabilité (fichier JSON).</li>
              <li><strong>Modifier</strong> votre nom et votre photo : rectification.</li>
              <li><strong>Supprimer mon compte</strong> : effacement. Votre compte devient « Ancien auditeur » dans l'historique des stations ; e-mail, mot de passe, photo, sessions, clés et retours sont effacés.</li>
            </ul>
            <p>
              Pour toute autre demande, contactez le responsable{reach && <> ({reach})</>} ; réponse sous un mois. Vous
              pouvez aussi introduire une réclamation auprès de la <strong>CNIL</strong> (3 place de Fontenoy, TSA 80715,
              75334 Paris Cedex 07 ; www.cnil.fr).
            </p>
          </Section>

          <Section title="8. Mineurs">
            <p>Le service n'est pas destiné aux moins de 15 ans sans l'accord d'un titulaire de l'autorité parentale (article 45 de la loi Informatique et Libertés).</p>
          </Section>

          <Section title="9. Modifications">
            <p>
              Cette notice est mise à jour dès que la radio change sa façon de traiter vos données ; sa date figure en haut
              de page. Après chaque modification, nous vous demandons d'en prendre connaissance à votre prochaine connexion.
            </p>
          </Section>
        </>
      ) : (
        <>
          <Section title="1. Who is responsible for your data?">
            <p>The data controller is {who}{reach && <> Contact: {reach}.</>}</p>
          </Section>

          <Section title="2. What we keep, why, and for how long">
            <Table
              head={["Data", "Why", "Legal basis", "How long"]}
              rows={[
                [<><strong>Account</strong>: email, display name, password (never in clear: a salted argon2id hash), role, theme, creation dates</>, "To identify you and run your account", "Providing the service (GDPR art. 6.1.b)", "Until you delete the account"],
                [<><strong>Profile photo</strong> (optional), re-encoded to 256×256, metadata (EXIF, GPS) removed</>, "To show you to other listeners", "Providing the service", "Until you remove it or delete the account"],
                [<><strong>Session</strong>: the {code("lr_session")} cookie (a random token, stored only as a hash)</>, "To keep you signed in", "Providing the service", "30 days, or until you sign out"],
                [<><strong>Songs you add</strong> (link, title, station, dates) and <strong>votes to skip</strong></>, "To run the queue, history, station stats and Alfred's picks", "Providing the service; legitimate interest (art. 6.1.f)", "As long as the station exists; anonymised when you delete your account"],
                [<><strong>Feedback</strong> you send (text, kind, read/archived status)</>, "To improve the radio", "Legitimate interest", "Until deleted, or your account is"],
                [<><strong>API and AI access</strong>: key names and scopes, connected apps, usage dates; tokens stored only as hashes</>, "To let your tools act for you", "Providing the service", "Until revoked; access tokens 1 h, refresh tokens 60 days, codes 10 min"],
                [<><strong>Email confirmation</strong>: when your address was confirmed; one-time links (stored only as hashes)</>, "To prove the address is yours, so you can join private stations open to your domain", "Providing the service", "Links: 24 h; date: lifetime of the account"],
                [<><strong>Private stations</strong>: the stations an admin added you to</>, "To give you access to them", "Providing the service", "Until an admin removes you, or you delete the account"],
                [<><strong>Acknowledgement of this notice</strong> (version, date)</>, "To show you were informed", "Legitimate interest", "Lifetime of the account"],
                [<><strong>IP address</strong>: in memory to limit abuse and count listeners; in the web server's technical logs (IP, date, page)</>, "Security, abuse prevention", "Legitimate interest", "Memory: 45 s to 24 h, gone on restart; logs: rotated automatically (~30 MB per service, a few weeks at most)"],
              ]}
            />
          </Section>

          <Section title="3. What we don't do">
            <ul className="list-disc space-y-1 pl-5">
              <li>No advertising, no audience measurement, no trackers or third-party cookies.</li>
              <li>No selling or renting of data, no profiling.</li>
              <li>No personal listening history: we count listeners live without keeping who listened to what.</li>
              <li>No payment data, no geolocation. Photos lose their metadata on upload.</li>
            </ul>
          </Section>

          <Section title="4. Cookies and storage in your browser">
            <Table
              head={["Name", "Type", "Purpose", "Lifetime"]}
              rows={[
                [code("lr_session"), "Cookie (HttpOnly)", "Sign-in: strictly necessary", "30 days"],
                [code("lr_theme"), "Local storage", "Your theme (Night, Light, Vintage)", "Until cleared"],
                [code("lr_volume"), "Local storage", "Player volume", "Until cleared"],
                [code("lr_search_source"), "Local storage", "Your chosen search service", "Until cleared"],
                [code("lr_listener"), "Local storage", "A random id used to count listeners", "Until cleared"],
              ]}
            />
            <p>
              These are strictly necessary or serve a feature you asked for, so they're exempt from consent (article 82
              of the French Data Protection Act, CNIL guidelines). That's why there's no cookie banner: we only ask you
              to read this notice when you sign up, and again whenever it changes.
            </p>
          </Section>

          <Section title="5. Who sees your data">
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Other listeners</strong> see your display name, photo and the songs you add.</li>
              <li><strong>The radio's admins</strong> also see your email and your feedback.</li>
              <li><strong>Email delivery</strong>: to send your confirmation link, your address is passed to the mail (SMTP) service the controller chose.</li>
              <li><strong>Music services</strong>: our server fetches songs from YouTube, SoundCloud, Bandcamp and others; your IP address isn't passed on. Song <strong>thumbnails</strong>, however, are loaded by your browser straight from their servers (Google/YouTube, SoundCloud), which then receive your IP address and may be outside the European Union.</li>
              <li><strong>AI assistants</strong> you connect: what our tools return to them is handled by their provider under its own policy.</li>
            </ul>
          </Section>

          <Section title="6. Hosting and security">
            <p>
              The Last Radio is self-hosted by the data controller; we don't transfer your data outside the European
              Union, except for the thumbnails above. Passwords hashed with salted argon2id, tokens hashed (SHA-256),
              rate limits, protection against cross-site requests and requests to internal addresses, admin actions only
              from the website.
            </p>
          </Section>

          <Section title="7. Your rights">
            <p>
              You have the rights of access, rectification, erasure, restriction, objection and portability, and may
              leave instructions for your data after your death (article 85 of the French Data Protection Act). Straight
              from "Edit profile":
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Download my data</strong>: access and portability (a JSON file).</li>
              <li><strong>Edit</strong> your name and photo: rectification.</li>
              <li><strong>Delete my account</strong>: erasure. You become "Former listener" in station history; your email, password, photo, sessions, keys and feedback are erased.</li>
            </ul>
            <p>
              For anything else, contact the controller{reach && <> ({reach})</>}; we answer within a month. You can also
              complain to the French data protection authority, the <strong>CNIL</strong> (3 place de Fontenoy, TSA 80715,
              75334 Paris Cedex 07; www.cnil.fr).
            </p>
          </Section>

          <Section title="8. Children">
            <p>The service isn't meant for children under 15 without the consent of a parent (article 45 of the French Data Protection Act).</p>
          </Section>

          <Section title="9. Changes">
            <p>
              This notice is updated as soon as the radio changes how it handles your data; its date is at the top. After
              every change, we ask you to read it at your next sign-in.
            </p>
          </Section>
        </>
      )}
    </article>
  );
}
