import { createLogger } from '@jam/core';

const log = createLogger('IntentClassifier');

/**
 * Intent categories for command classification.
 * These map to different types of agent capabilities.
 */
export type IntentType =
  | 'code'        // Programming tasks, file operations, development
  | 'research'    // Web search, information gathering, lookups
  | 'system'      // App control, settings, status queries
  | 'general';    // Conversational, fallback, unclear

/**
 * Classification result with confidence score.
 */
export interface IntentClassification {
  type: IntentType;
  confidence: number; // 0-1
  matchedPatterns: string[];
}

/**
 * Pattern entry for intent matching.
 * Uses regex for flexible keyword and phrase matching.
 */
interface IntentPattern {
  type: IntentType;
  regex: RegExp;
  description: string;
  weight?: number; // Higher weight = higher influence on confidence
}

/**
 * IntentClassifier - Keyword/pattern-based command categorization.
 *
 * Uses a registry pattern (OCP) for extensible intent detection.
 * New patterns can be added without modifying the classification logic.
 *
 * Design decisions:
 * - Keyword matching over ML: simpler, faster, more predictable
 * - Pattern registry: extensible without code changes
 * - Confidence scoring: allows for fallback behavior
 * - Case-insensitive matching: better voice/text command handling
 */
export class IntentClassifier {
  private patterns: IntentPattern[] = [];

  constructor() {
    this.registerDefaultPatterns();
  }

  /**
   * Register a new intent pattern.
   * This is the extension point for adding new intent detection rules (OCP).
   */
  registerPattern(
    type: IntentType,
    regex: RegExp,
    description: string,
    weight = 1.0
  ): void {
    this.patterns.push({ type, regex, description, weight });
    log.debug(`Registered pattern: ${type} - ${description}`);
  }

  /**
   * Classify a command text into an intent category.
   * Returns the best matching intent with confidence score.
   */
  classify(command: string): IntentClassification {
    if (!command || command.trim().length === 0) {
      return {
        type: 'general',
        confidence: 0,
        matchedPatterns: [],
      };
    }

    const scores = new Map<IntentType, { score: number; patterns: string[] }>();
    const normalized = command.toLowerCase().trim();

    // Initialize all intent types with baseline
    const intentTypes: IntentType[] = ['code', 'research', 'system', 'general'];
    for (const type of intentTypes) {
      scores.set(type, { score: 0, patterns: [] });
    }

    // Score each pattern
    for (const pattern of this.patterns) {
      if (pattern.regex.test(normalized)) {
        const current = scores.get(pattern.type)!;
        current.score += pattern.weight ?? 1.0;
        current.patterns.push(pattern.description);
      }
    }

    // Find the best matching intent
    let bestType: IntentType = 'general';
    let bestScore = 0;
    let bestPatterns: string[] = [];

    for (const [type, data] of scores.entries()) {
      if (data.score > bestScore) {
        bestType = type;
        bestScore = data.score;
        bestPatterns = data.patterns;
      }
    }

    // Calculate confidence (normalize to 0-1 range)
    const maxScore = Math.max(...Array.from(scores.values()).map(s => s.score));
    const confidence = maxScore > 0 ? bestScore / maxScore : 0;

    const result: IntentClassification = {
      type: bestType,
      confidence,
      matchedPatterns: bestPatterns,
    };

    log.debug(
      `Classified "${command.slice(0, 50)}..." -> ${bestType} (confidence: ${confidence.toFixed(2)})`
    );

    return result;
  }

  /**
   * Get all registered patterns for a specific intent type.
   */
  getPatternsForType(type: IntentType): IntentPattern[] {
    return this.patterns.filter(p => p.type === type);
  }

  /**
   * Register default intent patterns.
   * This provides a solid baseline for common command types.
   */
  private registerDefaultPatterns(): void {
    // Code intent patterns - programming and development tasks
    const codePatterns: Array<{ regex: RegExp; desc: string; weight?: number }> = [
      // Programming actions
      { regex: /\b(write|create|add|implement|build|develop|code|program)\s+(?:a\s+)?(?:function|class|component|module|script|app|feature|api|endpoint|handler|service)\b/i, desc: 'create code structure', weight: 2.0 },
      { regex: /\b(refactor|optimize|fix|debug|test|review|improve)\b/i, desc: 'code quality action', weight: 1.5 },
      { regex: /\b(change|modify|update|edit|delete|remove)\s+(?:the\s+)?(?:code|function|file|component|class)\b/i, desc: 'modify existing code', weight: 1.5 },

      // File operations
      { regex: /\b(create|make|add|write|save|new)\s+(?:a\s+)?(?:file|directory|folder|document)\b/i, desc: 'create file/folder', weight: 1.5 },
      { regex: /\b(read|open|show|display|check|view|list)\s+(?:the\s+)?(?:file|files|directory|folder|code|source)\b/i, desc: 'read/view files', weight: 1.0 },
      { regex: /\b(delete|remove|rm|unlink)\s+(?:the\s+)??(?:file|files|directory|folder)\b/i, desc: 'delete files', weight: 1.0 },

      // Git and version control
      { regex: /\b(commit|push|pull|clone|checkout|branch|merge|rebase|git|github|gitlab)\b/i, desc: 'git operation', weight: 1.5 },

      // Build and deployment
      { regex: /\b(build|compile|deploy|release|publish|package|install|npm|yarn|pip|cargo|gem|brew|apt)\b/i, desc: 'build/deploy', weight: 1.5 },
      { regex: /\b(run|start|execute|launch|test|debug)\s+(?:the\s+)?(?:app|application|server|tests?|suite|script|program)\b/i, desc: 'run application/tests', weight: 1.5 },

      // Code analysis
      { regex: /\b(analyze|explain|understand|document|comment|describe)\s+(?:the\s+)??(?:code|function|class|module|logic|implementation)\b/i, desc: 'code analysis', weight: 1.0 },

      // Tech stack keywords
      { regex: /\b(typescript|javascript|python|java|go|rust|cpp|c\+\+|c#|ruby|php|swift|kotlin|scala|html|css|sql|graphql|rest|graphql|api)\b/i, desc: 'programming language', weight: 0.8 },
      { regex: /\b(react|vue|angular|svelte|node|express|django|flask|rails|laravel|spring|django|fastapi)\b/i, desc: 'framework', weight: 0.8 },

      // Development tools
      { regex: /\b(debugger|linter|formatter|ide|editor|terminal|console|shell|bash|zsh|fish)\b/i, desc: 'dev tools', weight: 0.5 },
    ];

    for (const { regex, desc, weight } of codePatterns) {
      this.registerPattern('code', regex, desc, weight);
    }

    // Research intent patterns - information gathering and web search
    const researchPatterns: Array<{ regex: RegExp; desc: string; weight?: number }> = [
      // Search and lookup
      { regex: /\b(search|find|look\s+up|look\s+for|find\s+out|google|bing|query)\b/i, desc: 'search query', weight: 2.0 },
      { regex: /\b(what|who|where|when|why|how)\s+(?:is|are|was|were|to|do|does|did|can|could|should|would)\b/i, desc: 'question word', weight: 1.5 },

      // Information gathering
      { regex: /\b(research|investigate|explore|discover|learn|study|understand)\b/i, desc: 'research action', weight: 1.5 },
      { regex: /\b(tell\s+me|show\s+me|explain|describe|define|meaning|information|about|details?|overview|summary)\b/i, desc: 'information request', weight: 1.0 },

      // Specific lookups
      { regex: /\b(weather|news|stock|price|latest|current|recent|today|tomorrow|yesterday)\b/i, desc: 'current info lookup', weight: 1.2 },
      { regex: /\b(documentation|docs|tutorial|guide|example|reference|manual|readme)\b/i, desc: 'documentation lookup', weight: 1.0 },

      // Comparison and analysis
      { regex: /\b(compare|difference|vs|versus|better|best|worst|ranking|top|bottom|list|of)\b/i, desc: 'comparison/analysis', weight: 1.0 },
      { regex: /\b(history|background|context|origin|source|timeline|evolution)\b/i, desc: 'historical info', weight: 0.8 },
    ];

    for (const { regex, desc, weight } of researchPatterns) {
      this.registerPattern('research', regex, desc, weight);
    }

    // System intent patterns - app control and status
    const systemPatterns: Array<{ regex: RegExp; desc: string; weight?: number }> = [
      // Status queries
      { regex: /\b(status|state|current|running|active|available|health|check)\b/i, desc: 'status query', weight: 2.0 },
      { regex: /\b(what'?s\s+(?:going\s+on|happening)|what'?s\s+up|how'?s\s+it\s+going)\b/i, desc: 'casual status', weight: 1.5 },

      // Control commands
      { regex: /\b(start|stop|pause|resume|restart|reboot|shutdown|kill|abort|cancel|quit|exit)\b/i, desc: 'control action', weight: 1.5 },
      { regex: /\b(enable|disable|toggle|switch|turn\s+(?:on|off)|activate|deactivate)\b/i, desc: 'toggle action', weight: 1.5 },

      // Configuration
      { regex: /\b(config|settings?|preferences?|options?|setup|configure|adjust|change\s+settings?)\b/i, desc: 'configuration', weight: 1.5 },
      { regex: /\b(add|create|new|remove|delete|manage)\s+(?:agent|skill|service|integration)\b/i, desc: 'manage resources', weight: 1.5 },

      // System information
      { regex: /\b(version|info|about|help|usage|how\s+to|documentation|manual)\b/i, desc: 'system info', weight: 1.0 },
      { regex: /\b(list|show|display|get)\s+(?:all\s+)?(?:agents|services|tasks|processes|jobs)\b/i, desc: 'list resources', weight: 1.5 },

      // Maintenance
      { regex: /\b(clear|clean|reset|refresh|reload|restart|reindex|sync|update|upgrade)\b/i, desc: 'maintenance action', weight: 1.0 },
      { regex: /\b(log|logs|debug|diagnostic|trace|verbose|quiet)\b/i, desc: 'logging/debug', weight: 1.0 },
    ];

    for (const { regex, desc, weight } of systemPatterns) {
      this.registerPattern('system', regex, desc, weight);
    }

    // General intent patterns - conversational and fallback
    const generalPatterns: Array<{ regex: RegExp; desc: string; weight?: number }> = [
      { regex: /\b(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\b/i, desc: 'greeting', weight: 1.0 },
      { regex: /\b(thank|thanks|appreciate)\b/i, desc: 'gratitude', weight: 1.0 },
      { regex: /\b(yes|no|okay|ok|sure|alright|got\s+it|understood|roger|copy)\b/i, desc: 'affirmation', weight: 1.0 },
      { regex: /\b(bye|goodbye|see\s+ya|later|ciao)\b/i, desc: 'farewell', weight: 1.0 },
    ];

    for (const { regex, desc, weight } of generalPatterns) {
      this.registerPattern('general', regex, desc, weight);
    }

    log.debug(`Registered ${this.patterns.length} default intent patterns`);
  }
}
