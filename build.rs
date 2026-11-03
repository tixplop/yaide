fn main() {
    println!("cargo:rerun-if-changed=web/dist");
    for f in [
        "index.html",
        "main.js",
        "tokens.css",
        "composants.css",
        "theme.js",
        "polices/JetBrainsMono-Regular.woff2",
        "polices/JetBrainsMono-Italic.woff2",
        "polices/JetBrainsMono-SemiBold.woff2",
        "polices/OFL.txt",
    ] {
        if !std::path::Path::new("web/dist").join(f).exists() {
            panic!("web/dist/{f} est absent : lancez d'abord `npm run build`.");
        }
    }
}
