/* Petition settings — fill these in once (see SETUP-PETITION.md).
   Until projectId and apiKey are filled in, the petition banner stays hidden
   on the website so nobody sees a form that can't save. */
window.PETITION_CONFIG = {
    projectId: '',   // Firebase project ID, e.g. 'bmet-petition'
    apiKey: '',      // Firebase "Web API key" (safe to be public)
    adminEmail: '',  // the email you sign in with on petition-admin.html
    round: 1         // raise to 2, 3… to show the banner again to everyone (even people who already signed)
};
