use std::io::Write;
#[allow(dead_code)]
mod agent;
mod apercu;
mod auth;
mod cli;
mod config;
#[allow(dead_code)]
mod connaissance;
mod depot;
mod fichiers;
mod git;
mod opencode;
mod recherche;
mod serveur;
mod shells;
mod tls;
mod version;

use cli::Commande;

fn echec(code: i32, msg: &str) -> ! {
    eprintln!("Erreur : {msg}");
    std::process::exit(code);
}

/// Commande qui lance `install.sh` (embarqué) pour remplacer le binaire lancé.
fn commande_mise_a_jour() -> Result<std::process::Command, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dossier = exe.parent().ok_or("dossier du binaire introuvable")?;
    let mut cmd = std::process::Command::new("sh");
    cmd.arg("-c")
        .arg(include_str!("../install.sh"))
        .arg("yaide-update")
        .env("YAIDE_BIN_DIR", dossier);
    Ok(cmd)
}

/// Lance `install.sh`, puis sort avec son code.
fn mettre_a_jour() -> ! {
    let statut = commande_mise_a_jour()
        .unwrap_or_else(|e| echec(1, &e))
        .status()
        .unwrap_or_else(|e| echec(1, &format!("lancement de sh impossible : {e}")));
    std::process::exit(statut.code().unwrap_or(1));
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let commande = cli::analyser(&args).unwrap_or_else(|e| echec(2, &e));
    if let Commande::Aide(texte) = commande {
        print!("{texte}");
        std::process::exit(0);
    }
    if commande == Commande::Update {
        mettre_a_jour();
    }
    let config = config::dossier_config().unwrap_or_else(|e| echec(1, &e));
    match commande {
        Commande::Update | Commande::Aide(_) => unreachable!(),
        Commande::Passwd => {
            let mdp = cli::lire_mot_de_passe().unwrap_or_else(|e| echec(1, &e));
            config::definir_mot_de_passe(&config, &mdp).unwrap_or_else(|e| echec(1, &e));
            println!("Mot de passe enregistré.");
        }
        Commande::Servir { dossier, port } => {
            if !dossier.is_dir() {
                echec(
                    1,
                    &format!(
                        "le dossier {} est absent ou n'est pas un dossier",
                        dossier.display()
                    ),
                );
            }
            if !config::mot_de_passe_defini(&config) {
                echec(
                    1,
                    "aucun mot de passe défini ; lancez d'abord `yaide passwd`",
                );
            }
            let projet = dossier.canonicalize().unwrap_or(dossier.clone());
            let (cert, cle) = tls::assurer_certificat(&config).unwrap_or_else(|e| echec(1, &e));
            let listener = serveur::ecouter(port).unwrap_or_else(|e| echec(1, &e));
            let pris = listener
                .local_addr()
                .unwrap_or_else(|e| echec(1, &e.to_string()))
                .port();
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .unwrap_or_else(|e| echec(1, &e.to_string()));
            // Une sortie standard fermée ne doit pas arrêter le serveur.
            let mut sortie = std::io::stdout();
            if pris != port && port != 0 {
                let _ = writeln!(
                    sortie,
                    "Le port {port} est occupé : Yaide utilise le port {pris}."
                );
            }
            let _ = writeln!(
                sortie,
                "Yaide écoute sur le port {pris}, sur toutes les adresses de la machine."
            );
            let _ = writeln!(sortie, "Sur cette machine : https://localhost:{pris}");
            let _ = writeln!(
                sortie,
                "Depuis une autre machine : https://<adresse de la machine>:{pris}"
            );
            if let Err(e) = rt.block_on(serveur::servir(listener, &cert, &cle, &config, &projet)) {
                echec(1, &e);
            }
        }
    }
}
