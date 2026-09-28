import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/**
 * The privacy notice. Keep it true: whenever the app starts storing,
 * sharing or keeping something differently, update both languages below and
 * POLICY_VERSION (here and in apps/server/src/lib/legal.ts). See CLAUDE.md.
 */
export const POLICY_VERSION = "2026-09-28.3";
const UPDATED = { fr: "28 septembre 2026", en: "28 September 2026" };

type Legal = {
  policyVersion: string;
  controller: string | null;
  contact: string | null;
  hosting: string | null;
  dataLocation: string | null;
  /** Station export/import is on: the notice describes its files. */
  stationTransfer: boolean;
};
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
        ? <><strong>{controller}</strong>, qui fait fonctionner cette radio.</>
        : <>la <strong>personne qui administre cette radio</strong>. Ses coordonnées ne sont pas encore indiquées ici : demandez-les avec « Envoyer un retour ».</>
      : controller
        ? <><strong>{controller}</strong>, who runs this instance of The Last Radio.</>
        : <>the <strong>administrator of this instance</strong> of The Last Radio (contact details not set yet: ask through "Send feedback").</>;
  const reach = contact ? <a className="text-foreground underline" href={`mailto:${contact}`}>{contact}</a> : null;
  const hosting = data?.hosting;
  const where = data?.dataLocation;

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
            ? "Cette notice suit le Règlement général sur la protection des données (RGPD) et la loi « Informatique et Libertés » du 6 janvier 1978 modifiée. En cas de doute, c'est la version française qui compte."
            : "This notice applies the General Data Protection Regulation (GDPR) and the French Data Protection Act (loi « Informatique et Libertés ») of 6 January 1978 as amended. The French version prevails."}
        </p>
      </header>

      {lang === "fr" ? (
        <>
          <Section title="1. Qui est responsable de vos données ?">
            <p>Le responsable du traitement est {who}{reach && <> Pour le joindre : {reach}.</>}</p>
          </Section>

          <Section title="2. Ce que nous gardons, pourquoi, et combien de temps">
            <Table
              head={["Données", "À quoi elles servent", "Base légale", "Durée"]}
              rows={[
                [<><strong>Votre compte</strong> : e-mail, pseudo (le nom affiché aux autres, pas forcément votre vrai nom), mot de passe, rôle, thème, dates de création, et si les administrateurs vous laissent en dehors des statistiques (un compte de test, par exemple). Le mot de passe n'est jamais stocké tel quel : nous n'en gardons qu'une empreinte (argon2id, salée).</>, "Vous reconnaître et faire fonctionner votre compte", "Le service que vous utilisez (art. 6.1.b RGPD)", "Jusqu'à la suppression du compte"],
                [<><strong>Votre avatar</strong> (facultatif) : l'image est recadrée en 256×256 et débarrassée de ses métadonnées (EXIF, position GPS)</>, "Vous représenter auprès des autres auditeurs", "Le service", "Jusqu'à ce que vous le retiriez ou supprimiez le compte"],
                [<><strong>Votre session</strong> : le cookie {code("lr_session")}, un jeton aléatoire dont nous ne gardons qu'une empreinte</>, "Rester connecté", "Le service", "30 jours, ou jusqu'à la déconnexion"],
                [<><strong>Votre activité sur les stations</strong> : les chansons que vous ajoutez (lien, titre, station, dates), vos votes pour passer une chanson, et vos votes pour la réentendre (3 par jour)</>, "Faire tourner la file d'attente, l'historique, les statistiques et les choix d'Alfred", "Le service ; notre intérêt légitime (art. 6.1.f)", "Tant que la station existe. Si vous supprimez votre compte, elle reste, mais sans votre nom"],
                [<><strong>Vos retours</strong> : le message, son type et s'il a été lu ou archivé</>, "Améliorer la radio", "Notre intérêt légitime", "Jusqu'à ce qu'ils soient supprimés, ou votre compte"],
                [<><strong>Vos accès pour API et assistants IA</strong> : nom et droits des clés, applications connectées, dernières utilisations. Les jetons ne sont gardés que sous forme d'empreinte</>, "Laisser vos outils agir pour vous", "Le service", "Jusqu'à ce que vous les révoquiez ; jetons d'accès 1 h, de renouvellement 60 jours, codes 10 min"],
                [<><strong>La confirmation de votre e-mail</strong> : la date où vous l'avez confirmée, et les liens envoyés (à usage unique, gardés sous forme d'empreinte)</>, "Vérifier que l'adresse est bien la vôtre, pour ouvrir les stations privées de votre domaine", "Le service", "Liens : 24 h ; date : tant que le compte existe"],
                [<><strong>Vos stations privées</strong> : celles auxquelles un administrateur vous a ajouté</>, "Vous y donner accès", "Le service", "Jusqu'à ce qu'on vous en retire, ou la suppression du compte"],
                [<><strong>Votre accord sur cette notice</strong> : la version lue et la date</>, "Pouvoir montrer que vous avez été informé", "Notre intérêt légitime", "Tant que le compte existe"],
                [<><strong>Votre adresse IP</strong> : gardée en mémoire pour limiter les abus et compter les auditeurs, et notée dans les journaux techniques du serveur web (avec la date et la page demandée)</>, "Sécurité, lutte contre les abus", "Notre intérêt légitime", "En mémoire : de 45 s à 24 h, effacée à chaque redémarrage. Journaux : remplacés automatiquement (environ 30 Mo par service, quelques semaines au plus)"],
              ]}
            />
          </Section>

          <Section title="3. Ce que nous ne faisons pas">
            <ul className="list-disc space-y-1 pl-5">
              <li>Pas de publicité, pas de mesure d'audience, pas de traceurs ni de cookies tiers.</li>
              <li>Nous ne vendons ni ne louons vos données, et nous ne dressons pas de profil de vous.</li>
              <li>Pas d'historique de ce que vous écoutez : nous savons combien de personnes écoutent une station en ce moment, pas qui. Nous gardons seulement ce nombre, toutes les 5 minutes, pour les graphiques d'audience des administrateurs.</li>
              <li>Aucune donnée de paiement, aucune géolocalisation. Les avatars perdent leurs métadonnées dès l'envoi.</li>
            </ul>
          </Section>

          <Section title="4. Cookies et stockage dans votre navigateur">
            <Table
              head={["Nom", "Type", "À quoi il sert", "Durée"]}
              rows={[
                [code("lr_session"), "Cookie (HttpOnly)", "Rester connecté : indispensable", "30 jours"],
                [code("lr_theme"), "Stockage local", "Le thème affiché (Night, Light, Vintage)", "Jusqu'à ce que vous l'effaciez"],
                [code("lr_volume"), "Stockage local", "Le volume du lecteur", "Jusqu'à ce que vous l'effaciez"],
                [code("lr_search_source"), "Stockage local", "Le service de recherche choisi", "Jusqu'à ce que vous l'effaciez"],
                [code("lr_listener"), "Stockage local", "Un identifiant au hasard, pour compter les auditeurs", "Jusqu'à ce que vous l'effaciez"],
              ]}
            />
            <p>
              Ils sont tous indispensables au service ou servent une fonction que vous utilisez. La loi les dispense donc
              de consentement (article 82 de la loi Informatique et Libertés, lignes directrices de la CNIL). C'est
              pourquoi il n'y a pas de bandeau cookies : nous vous demandons seulement de lire cette notice à
              l'inscription, puis à chaque fois qu'elle change.
            </p>
          </Section>

          <Section title="5. Qui voit vos données">
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Les autres auditeurs</strong> voient votre pseudo, votre avatar et les chansons que vous ajoutez.</li>
              <li><strong>Les administrateurs</strong> de la radio voient en plus votre e-mail et vos retours.</li>
              {data?.stationTransfer && <li><strong>Le déménagement d'une station</strong> : un administrateur peut enregistrer une station entière (réglages, file d'attente, historique) dans un fichier, pour la recréer sur une autre radio The Last Radio. Ce fichier contient le pseudo et l'e-mail des personnes qui y ont ajouté des chansons ou voté (mais ni mot de passe, ni avatar, ni retour). Sur l'autre radio, votre activité est rattachée à votre compte s'il utilise le même e-mail ; sinon, elle reste affichée sous votre pseudo, sur un compte auquel personne ne peut se connecter.</li>}
              <li><strong>L'envoi d'e-mails</strong> : pour vous envoyer le lien de confirmation, votre adresse passe par le service d'envoi choisi par le responsable.</li>
              <li><strong>Les services de musique</strong> : c'est notre serveur qui récupère les chansons et leurs images sur YouTube, SoundCloud, Bandcamp, etc. Votre navigateur ne les contacte jamais, et votre adresse IP ne leur est pas transmise.</li>
              <li><strong>Les assistants IA</strong> que vous connectez : ce que nous leur envoyons est traité par leur éditeur, selon ses propres règles.</li>
            </ul>
          </Section>

          <Section title="6. Hébergement et sécurité">
            <p>
              {hosting ? (
                <>
                  La radio est hébergée par <strong>{hosting}</strong>.{where && <> Vos données sont stockées en <strong>{where}</strong>.</>}{" "}
                  Elles ne quittent pas l'Union européenne.
                </>
              ) : (
                <>
                  La radio est hébergée par son responsable lui-même. Vos données ne quittent pas l'Union européenne.
                </>
              )}{" "}
              Pour les protéger : mots de passe et jetons stockés uniquement sous forme d'empreinte, nombre de tentatives
              limité, protections contre les requêtes venues d'autres sites ou visant notre réseau interne, et actions
              d'administration possibles uniquement depuis le site.
            </p>
          </Section>

          <Section title="7. Vos droits">
            <p>
              Vous pouvez accéder à vos données, les corriger, les effacer, en limiter l'usage, vous y opposer et les
              récupérer. Vous pouvez aussi dire ce que vous souhaitez qu'elles deviennent après votre décès (article 85 de
              la loi Informatique et Libertés). Une bonne partie se fait directement dans « Modifier le profil » :
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Télécharger mes données</strong> : toutes vos données, dans un fichier JSON.</li>
              <li><strong>Modifier</strong> votre pseudo et votre avatar.</li>
              <li><strong>Supprimer mon compte</strong> : votre e-mail, mot de passe, avatar, sessions, clés et retours sont effacés. Dans l'historique des stations, vous devenez « Ancien auditeur ».</li>
            </ul>
            <p>
              Pour tout le reste, écrivez au responsable{reach && <> ({reach})</>} : il vous répond sous un mois. Si
              vous n'êtes pas satisfait, vous pouvez vous plaindre auprès de la <strong>CNIL</strong> (3 place de
              Fontenoy, TSA 80715, 75334 Paris Cedex 07 ; www.cnil.fr).
            </p>
          </Section>

          <Section title="8. Mineurs">
            <p>La radio n'est pas faite pour les moins de 15 ans, sauf avec l'accord d'un parent ou d'un autre titulaire de l'autorité parentale (article 45 de la loi Informatique et Libertés).</p>
          </Section>

          <Section title="9. Modifications">
            <p>
              Nous mettons cette notice à jour dès que la radio change sa façon d'utiliser vos données ; la date de la
              dernière version est en haut de la page. Après chaque changement, nous vous la montrons à votre prochaine
              connexion.
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
                [<><strong>Account</strong>: email, display name (a nickname is fine), password (never in clear: a salted argon2id hash), role, theme, creation dates, and whether the admins leave you out of statistics (test accounts, for example)</>, "To identify you and run your account", "Providing the service (GDPR art. 6.1.b)", "Until you delete the account"],
                [<><strong>Avatar</strong> (optional), re-encoded to 256×256, metadata (EXIF, GPS) removed</>, "To show you to other listeners", "Providing the service", "Until you remove it or delete the account"],
                [<><strong>Session</strong>: the {code("lr_session")} cookie (a random token, stored only as a hash)</>, "To keep you signed in", "Providing the service", "30 days, or until you sign out"],
                [<><strong>Songs you add</strong> (link, title, station, dates), <strong>votes to skip</strong> and <strong>upvotes</strong> (3 a day)</>, "To run the queue, history, station stats and Alfred's picks", "Providing the service; legitimate interest (art. 6.1.f)", "As long as the station exists; anonymised when you delete your account"],
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
              <li>No personal listening history: we count listeners live without keeping who listened to what. We only keep, every 5 minutes, the <strong>number</strong> of people listening to each station, for the admins' audience charts.</li>
              <li>No payment data, no geolocation. Avatars lose their metadata on upload.</li>
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
              <li><strong>Other listeners</strong> see your display name, avatar and the songs you add.</li>
              <li><strong>The radio's admins</strong> also see your email and your feedback.</li>
              {data?.stationTransfer && <li><strong>Moving a station</strong>: an admin can export a station (settings, queue, history) to a file, to recreate it on another instance of The Last Radio. The file holds the display name and email of the people who added, voted on or upvoted its songs (no passwords, avatars or feedback). On import, your contributions are linked to your account on that instance if it has the same email; otherwise they stay under your display name, on an account nobody can sign in to.</li>}
              <li><strong>Email delivery</strong>: to send your confirmation link, your address is passed to the mail (SMTP) service the controller chose.</li>
              <li><strong>Music services</strong>: our server fetches songs and their artwork from YouTube, SoundCloud, Bandcamp and others. Your browser never contacts them, and your IP address isn't passed on.</li>
              <li><strong>AI assistants</strong> you connect: what our tools return to them is handled by their provider under its own policy.</li>
            </ul>
          </Section>

          <Section title="6. Hosting and security">
            <p>
              {hosting ? (
                <>
                  Hosted by <strong>{hosting}</strong>.{where && <> Your data is stored in <strong>{where}</strong>.</>} We
                  don't transfer your data outside the European Union.
                </>
              ) : (
                <>
                  The Last Radio is self-hosted by the data controller; we don't transfer your data outside the European
                  Union.
                </>
              )}{" "}
              Passwords hashed with salted argon2id, tokens hashed (SHA-256),
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
              <li><strong>Edit</strong> your display name and avatar: rectification.</li>
              <li><strong>Delete my account</strong>: erasure. You become "Former listener" in station history; your email, password, avatar, sessions, keys and feedback are erased.</li>
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
