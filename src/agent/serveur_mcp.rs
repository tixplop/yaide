//! Serveur MCP de Yaide (REQ-189) : les outils intégrés des agents, offerts aux harnais externes.

use crate::agent::conversation::Gestionnaire;
use crate::agent::outils;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ErrorData, JsonObject,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{RoleServer, ServerHandler};
use std::sync::Arc;

#[derive(Clone)]
struct Outils {
    agent: Arc<Gestionnaire>,
}

fn refus(texte: &str) -> CallToolResponse {
    CallToolResult::error(vec![ContentBlock::text(texte)]).into()
}

impl ServerHandler for Outils {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    }

    async fn list_tools(
        &self,
        _requete: Option<PaginatedRequestParams>,
        _contexte: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let tools = outils::integres(&self.agent.contexte().projet)
            .into_iter()
            .map(|d| {
                let schema: JsonObject = d.schema.as_object().cloned().unwrap_or_default();
                Tool::new(d.nom, d.description, schema)
            })
            .collect();
        Ok(ListToolsResult {
            tools,
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        requete: CallToolRequestParams,
        _contexte: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let nom = requete.name.to_string();
        if !outils::integres(&self.agent.contexte().projet)
            .iter()
            .any(|d| d.nom == nom)
        {
            return Ok(refus(&format!("Outil inconnu : {nom}.")));
        }
        if nom == "subagent" {
            return Ok(refus(
                "Le sous-agent n'est pas encore disponible par le serveur MCP.",
            ));
        }
        let arguments = serde_json::Value::Object(requete.arguments.unwrap_or_default());
        let r = outils::executer(&nom, &arguments, &self.agent.contexte()).await;
        let contenu = vec![ContentBlock::text(r.contenu)];
        Ok(if r.echec {
            CallToolResult::error(contenu)
        } else {
            CallToolResult::success(contenu)
        }
        .into())
    }
}

/// Le routeur du serveur MCP sur `/mcp`, pour l'écouteur de port `port`.
pub fn routeur(agent: Arc<Gestionnaire>, port: u16) -> axum::Router {
    let config = StreamableHttpServerConfig::default().with_allowed_origins([
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
    ]);
    let service = StreamableHttpService::new(
        move || {
            Ok(Outils {
                agent: agent.clone(),
            })
        },
        Arc::new(LocalSessionManager::default()),
        config,
    );
    axum::Router::new().route_service("/mcp", service)
}
