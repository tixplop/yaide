mod auth;
mod cli;
mod config;
mod serveur;
mod shells;
mod tls;

use cli::Commande;

fn echec(code: i32, msg: &str) -> ! {
    eprintln!("Erreur : {msg}");
    std::process::exit(code);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let commande = cli::analyser(&args).unwrap_or_else(|e| echec(2, &e));
    let config = config::dossier_config().unwrap_or_else(|e| echec(1, &e));
    match commande {
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
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .unwrap_or_else(|e| echec(1, &e.to_string()));
            println!("Yaide écoute sur https://0.0.0.0:{port}");
            if let Err(e) = rt.block_on(serveur::servir(listener, &cert, &cle, &config, &projet)) {
                echec(1, &e);
            }
        }
    }
}
