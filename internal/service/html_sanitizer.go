package service

import (
	"strings"

	"github.com/microcosm-cc/bluemonday"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

var entryContentPolicy = bluemonday.UGCPolicy()

func sanitizeEntryContent(htmlContent string) string {
	if htmlContent == "" {
		return ""
	}

	return openEntryContentLinksInNewTab(entryContentPolicy.Sanitize(htmlContent))
}

func openEntryContentLinksInNewTab(htmlContent string) string {
	nodes, err := html.ParseFragment(strings.NewReader(htmlContent), &html.Node{
		Type:     html.ElementNode,
		DataAtom: atom.Div,
		Data:     "div",
	})
	if err != nil {
		return htmlContent
	}

	for _, node := range nodes {
		updateEntryContentLinks(node)
	}

	var sanitized strings.Builder
	for _, node := range nodes {
		err = html.Render(&sanitized, node)
		if err != nil {
			return htmlContent
		}
	}

	return sanitized.String()
}

func updateEntryContentLinks(node *html.Node) {
	if node.Type == html.ElementNode && node.Data == "a" && htmlNodeAttr(node, "href") != "" {
		setHTMLNodeAttr(node, "target", "_blank")
		ensureHTMLNodeRelTokens(node, "noopener", "noreferrer")
	}

	for child := node.FirstChild; child != nil; child = child.NextSibling {
		updateEntryContentLinks(child)
	}
}

func htmlNodeAttr(node *html.Node, key string) string {
	for _, attr := range node.Attr {
		if attr.Key == key {
			return attr.Val
		}
	}

	return ""
}

func setHTMLNodeAttr(node *html.Node, key string, value string) {
	for i := range node.Attr {
		if node.Attr[i].Key == key {
			node.Attr[i].Val = value
			return
		}
	}

	node.Attr = append(node.Attr, html.Attribute{Key: key, Val: value})
}

func ensureHTMLNodeRelTokens(node *html.Node, tokens ...string) {
	rel := htmlNodeAttr(node, "rel")
	existingTokens := strings.Fields(rel)
	tokenSet := make(map[string]struct{}, len(existingTokens)+len(tokens))
	for _, token := range existingTokens {
		tokenSet[strings.ToLower(token)] = struct{}{}
	}

	for _, token := range tokens {
		if _, ok := tokenSet[strings.ToLower(token)]; ok {
			continue
		}
		existingTokens = append(existingTokens, token)
		tokenSet[strings.ToLower(token)] = struct{}{}
	}

	setHTMLNodeAttr(node, "rel", strings.Join(existingTokens, " "))
}
