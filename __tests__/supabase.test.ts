import { createClient } from '../lib/supabase/client';

describe('Supabase Connection', () => {
  it('should successfully connect to Supabase', async () => {
    const supabase = createClient();
    
    // Test a simple query
    const { data, error } = await supabase
      .from('books')
      .select('*')
      .limit(1);
    
    // Check if we can connect without errors
    expect(error).toBeNull();
    // Verify we get a response (even if table is empty)
    expect(data).toBeDefined();
  });
}); 