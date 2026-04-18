import Anthropic from '@anthropic-ai/sdk';

// Reads ANTHROPIC_API_KEY from env automatically
const claude = new Anthropic();

export default claude;
