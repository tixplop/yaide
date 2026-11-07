#[allow(dead_code)]
mod agent;
mod auth;
mod cli;
mod config;
mod depot;
mod fichiers;
mod git;
mod recherche;
mod serveur;
mod shells;
mod tls;

use cli::Commande;

fn echec(code: i32, msg: &str) -> ! {
    eprintln!("Erreur : {msg}");
    std::process::exit(code);
}

/// Lance `install.sh` (embarqué) pour remplacer le binaire lancé, puis sort avec son code.
fn mettre_a_jour() -> ! {
    let exe = std::env::current_exe().unwrap_or_else(|e| echec(1, &e.to_string()));
    let dossier = exe
        .parent()
        .unwrap_or_else(|| echec(1, "dossier du binaire introuvable"));
    let statut = std::process::Command::new("sh")
        .arg("-c")
        .arg(include_str!("../install.sh"))
        .arg("yaide-update")
        .env("YAIDE_BIN_DIR", dossier)
        .status()
        .unwrap_or_else(|e| echec(1, &format!("lancement de sh impossible : {e}")));
    std::process::exit(statut.code().unwrap_or(1));
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let commande = cli::analyser(&args).unwrap_or_else(|e| echec(2, &e));
    if commande == Commande::Update {
        mettre_a_jour();
    }
    let config = config::dossier_config().unwrap_or_else(|e| echec(1, &e));
    match commande {
        Commande::Update => unreachable!(),
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
            if pris != port && port != 0 {
                println!("Le port {port} est occupé : Yaide utilise le port {pris}.");
            }
            println!("Yaide écoute sur le port {pris}, sur toutes les adresses de la machine.");
            println!("Sur cette machine : https://localhost:{pris}");
            println!("Depuis une autre machine : https://<adresse de la machine>:{pris}");
            if let Err(e) = rt.block_on(serveur::servir(listener, &cert, &cle, &config, &projet)) {
                echec(1, &e);
            }
        }
    }
}
